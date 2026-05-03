"""
Wildfire Drone Coordination Backend
------------------------------------
Fully local. No external APIs required — NASA FIRMS data is pre-cached.
Set FIRMS_MAP_KEY env var to switch to live FIRMS hotspot data.

Run:
    uvicorn main:app --reload --port 8000

Docs (auto-generated):
    http://localhost:8000/docs
"""
import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import state
from models import Event, MeshStatus
from routers import drones, missions, regions, events, fires, optimizer, operators
from routers.fires import sync_fire_zones

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

        if g.tick % _OPTIMIZER_INTERVAL == 0:
            result = run_optimizer(None, None)
            ts = datetime.now().strftime("%H:%M")
            n = len(result.assignments)
            burning = g.burning_count()
            state.events.insert(0, Event(
                id=str(uuid.uuid4()),
                ts=ts,
                type="optimizer_rerun",
                message=f"Optimizer rerun · tick {g.tick} · {burning} cells burning · {n} assignments",
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
    title="Wildfire Drone Coordination API",
    description="Local backend for NASA wildfire UAS coordination with FIRMS data + fire simulation.",
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
        "service": "wildfire-drone-backend",
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
