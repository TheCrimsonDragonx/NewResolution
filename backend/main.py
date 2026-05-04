"""
UAS Traffic Management — Wildfire ICS Operations
-------------------------------------------------
4D trajectory deconfliction and airspace coordination for wildfire
incident command. Fully offline; no external APIs required.
NASA FIRMS hotspot data is pre-cached; set FIRMS_MAP_KEY for live feed.

Run:
    uvicorn main:app --reload --port 8000

Docs (auto-generated):
    http://localhost:8000/docs
"""
import asyncio
import math
import random
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import state
from models import Event, MeshStatus, DronePosition, DroneStatus, ConnectionStatus
from routers import drones, missions, regions, events, fires, optimizer, operators
from routers.fires import sync_fire_zones

_ORBIT_RADIUS_M = 130.0

# Mesh degradation simulation
_MESH_DEGRADE_INTERVAL = 15   # ticks between degradation events (~60 s at 4 s/tick)
_MESH_RECOVER_TICKS    = 8    # ticks in degraded state before auto-recovery (~32 s)
_mesh_degraded_node: str | None = None
_mesh_degraded_tick: int        = -1


def _advance_drones() -> None:
    """Move each assigned drone one step toward its target fire zone, then orbit."""
    speed = 800.0 * (_SIM_TICK_INTERVAL / 60.0)   # ~53 m/tick at 4s tick
    g = state.fire_grid
    tick = g.tick if g else 0

    for drone_id, fz_id in list(state.current_assignments.items()):
        drone = state.drones.get(drone_id)
        fz    = state.fire_zones.get(fz_id)
        if drone is None or fz is None or drone.status == DroneStatus.grounded:
            continue

        d_lat, d_lng = drone.position.lat, drone.position.lng
        t_lat, t_lng = fz.location.lat,    fz.location.lng

        dlat_m = (t_lat - d_lat) * 111_320.0
        dlng_m = (t_lng - d_lng) * 111_320.0 * math.cos(math.radians(d_lat))
        dist_m = math.hypot(dlat_m, dlng_m)

        if dist_m < _ORBIT_RADIUS_M:
            # Circular orbit around the fire zone
            angle   = tick * 0.12          # ~1 full orbit per 52 ticks (~3.5 min)
            r_lat   = _ORBIT_RADIUS_M / 111_320.0
            r_lng   = _ORBIT_RADIUS_M / (111_320.0 * math.cos(math.radians(t_lat)))
            new_lat = t_lat + r_lat * math.sin(angle)
            new_lng = t_lng + r_lng * math.cos(angle)
            new_alt = 400
        else:
            frac    = min(1.0, speed / dist_m)
            new_lat = d_lat + (t_lat - d_lat) * frac
            new_lng = d_lng + (t_lng - d_lng) * frac
            new_alt = max(300, drone.position.alt)

        state.drones[drone_id] = drone.model_copy(update={
            "position": DronePosition(lat=new_lat, lng=new_lng, alt=new_alt),
            "status":   DroneStatus.active,
        })


def _update_batteries() -> None:
    """Drain battery for flying drones; recharge grounded ones; RTB at low battery."""
    for drone_id, drone in list(state.drones.items()):
        updates: dict = {}

        if drone.status in (DroneStatus.active, DroneStatus.returning):
            new_bat = max(0, drone.battery - 1)          # 1 % per 4-second tick
            updates["battery"] = new_bat
            if new_bat <= 10 and drone.status == DroneStatus.active:
                updates["status"] = DroneStatus.returning
                state.current_assignments.pop(drone_id, None)
            if new_bat == 0:
                updates["status"] = DroneStatus.grounded

        elif drone.status == DroneStatus.grounded:
            new_bat = min(100, drone.battery + 3)        # recharge 3 % per tick
            updates["battery"] = new_bat
            if new_bat >= 85 and drone.battery < 85:     # ready to fly again
                updates["status"] = DroneStatus.idle

        if updates:
            state.drones[drone_id] = drone.model_copy(update=updates)


def _mesh_is_degraded() -> bool:
    return any(
        v != ConnectionStatus.ok
        for v in (state.mesh.radio, state.mesh.pingStation, state.mesh.network)
    )


def _update_mesh(tick: int) -> None:
    """Probabilistically degrade one mesh node every ~60 s; auto-recover after ~32 s."""
    global _mesh_degraded_node, _mesh_degraded_tick

    # Recovery: restore node after MESH_RECOVER_TICKS
    if _mesh_degraded_node and (tick - _mesh_degraded_tick) >= _MESH_RECOVER_TICKS:
        state.mesh = state.mesh.model_copy(update={_mesh_degraded_node: ConnectionStatus.ok})
        _mesh_degraded_node = None
        _mesh_degraded_tick = -1

    # Degradation: fire every MESH_DEGRADE_INTERVAL ticks when no node is already degraded
    if _mesh_degraded_node is None and tick > 0 and tick % _MESH_DEGRADE_INTERVAL == 0:
        node  = random.choice(["radio", "pingStation", "network"])
        level = random.choices(
            [ConnectionStatus.warning, ConnectionStatus.offline],
            weights=[65, 35],
        )[0]
        state.mesh = state.mesh.model_copy(update={node: level})
        _mesh_degraded_node = node
        _mesh_degraded_tick = tick


def _reset_mesh() -> None:
    """Restore all mesh nodes to ok and clear degradation tracking (called on sim reset)."""
    global _mesh_degraded_node, _mesh_degraded_tick
    state.mesh = MeshStatus(
        radio=ConnectionStatus.ok,
        pingStation=ConnectionStatus.ok,
        network=ConnectionStatus.ok,
    )
    _mesh_degraded_node = None
    _mesh_degraded_tick = -1


# Advance simulation every N seconds; re-run optimizer every OPTIMIZER_INTERVAL ticks
_SIM_TICK_INTERVAL = 4.0   # seconds between automatic ticks
_OPTIMIZER_INTERVAL = 10   # ticks between automatic optimizer runs


async def _fire_simulation_loop() -> None:
    """Background task: advance fire CA, sync fire zones, periodically re-run optimizer."""
    from optimizer_stub import run_optimizer
    while True:
        await asyncio.sleep(_SIM_TICK_INTERVAL)
        g = state.fire_grid
        if g is None:
            continue
        g.step()
        sync_fire_zones()
        _advance_drones()
        _update_batteries()

        # Auto-reset when fire burns out so the demo never goes dead
        if g.burning_count() == 0 and g.burnt_count() > 0:
            g.reset()
            _reset_mesh()   # clear any in-flight degradation so tick maths stay valid
            from nasa_firms import load_cached, firms_ignition_points
            for lat, lng in firms_ignition_points(load_cached()):
                g.ignite_at(lat, lng, radius_cells=0)
            for fz in state.fire_zones.values():
                g.ignite_at(fz.location.lat, fz.location.lng, radius_cells=1)
            ts = datetime.now().strftime("%H:%M")
            state.events.insert(0, Event(
                id=str(uuid.uuid4()),
                ts=ts,
                type="sim_reset",
                message=f"Fire re-ignition — new simulation cycle · {g.burning_count()} cells ignited",
            ))
            if len(state.events) > 30:
                state.events = state.events[:30]

        # Update mesh degradation BEFORE optimizer so the rerun sees current comms state
        _update_mesh(g.tick)

        if g.tick % _OPTIMIZER_INTERVAL == 0:
            # Run QUBO in a thread so the event loop stays free for poll requests
            result = await asyncio.to_thread(run_optimizer, None, None)
            ts = datetime.now().strftime("%H:%M")
            n = len(result.assignments)
            burning = g.burning_count()
            comms_note = " · REPLANNED UNDER DEGRADED COMMS" if _mesh_is_degraded() else ""
            state.events.insert(0, Event(
                id=str(uuid.uuid4()),
                ts=ts,
                type="optimizer_rerun",
                message=f"Optimizer rerun · tick {g.tick} · {burning} cells burning · {n} assignments{comms_note}",
            ))
            if len(state.events) > 30:
                state.events = state.events[:30]


@asynccontextmanager
async def lifespan(app: FastAPI):
    state.seed()
    task = asyncio.create_task(_fire_simulation_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="UAS Traffic Management — Wildfire ICS Operations",
    description="QUBO-based 4D trajectory deconfliction and role-scoped common operating picture for wildfire incident command. Offline-capable; NASA FIRMS VIIRS NRT data pre-cached.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(drones.router)
app.include_router(missions.router)
app.include_router(regions.router)
app.include_router(events.router)
app.include_router(fires.router)
app.include_router(optimizer.router)
app.include_router(operators.router)


@app.get("/", tags=["meta"])
def root():
    g = state.fire_grid
    return {
        "status": "ok",
        "service": "uas-traffic-management",
        "simulation": {
            "tick": g.tick if g else None,
            "burning": g.burning_count() if g else None,
        },
        "docs": "/docs",
    }


@app.get("/health", tags=["meta"])
def health():
    g = state.fire_grid
    return {
        "status": "ok",
        "drones": len(state.drones),
        "missions": len(state.missions),
        "fireZones": len(state.fire_zones),
        "regions": len(state.regions),
        "events": len(state.events),
        "simulation": {
            "tick": g.tick if g else None,
            "burning_count": g.burning_count() if g else None,
            "burnt_count": g.burnt_count() if g else None,
        },
    }


@app.get("/mesh", tags=["mesh"])
def get_mesh() -> MeshStatus:
    return state.mesh


@app.put("/mesh", tags=["mesh"])
def update_mesh(mesh_status: MeshStatus) -> MeshStatus:
    state.mesh = mesh_status
    return state.mesh
