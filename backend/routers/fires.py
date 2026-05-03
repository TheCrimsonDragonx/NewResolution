from fastapi import APIRouter, HTTPException, Depends
from models import FireZone, Operator, SimState, SimBounds, Priority
from deps import get_operator
import filters
import state
from fire_sim import BURNING, LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX, latLng_to_cell

router = APIRouter(prefix="/fires", tags=["fires"])


# ---------------------------------------------------------------------------
# Simulation endpoints  (must be declared before /{fire_id} to avoid shadowing)
# ---------------------------------------------------------------------------

@router.get("/simulation/state", response_model=SimState)
def get_sim_state():
    """Current fire grid state — poll this to drive the map overlay."""
    g = state.fire_grid
    if g is None:
        raise HTTPException(status_code=503, detail="Simulation not initialized")
    return SimState(
        tick=g.tick,
        rows=g.rows,
        cols=g.cols,
        wind_deg=g.wind_deg,
        wind_speed=g.wind_speed,
        burning_count=g.burning_count(),
        burnt_count=g.burnt_count(),
        cells=g.cells,
        bounds=SimBounds(lat_min=LAT_MIN, lat_max=LAT_MAX, lng_min=LNG_MIN, lng_max=LNG_MAX),
    )


@router.post("/simulation/tick")
def advance_sim(steps: int = 1):
    """Manually advance the simulation N steps (background task also auto-ticks)."""
    g = state.fire_grid
    if g is None:
        raise HTTPException(status_code=503, detail="Simulation not initialized")
    for _ in range(min(steps, 20)):
        g.step()
    sync_fire_zones()
    return {"tick": g.tick, "burning_count": g.burning_count(), "burnt_count": g.burnt_count()}


@router.post("/simulation/reset")
def reset_sim():
    """Reset grid to tick 0 and re-ignite from FIRMS cache + current fire zones."""
    g = state.fire_grid
    if g is None:
        raise HTTPException(status_code=503, detail="Simulation not initialized")
    g.reset()
    from nasa_firms import load_cached, firms_ignition_points
    for lat, lng in firms_ignition_points(load_cached()):
        g.ignite_at(lat, lng, radius_cells=0)
    for fz in state.fire_zones.values():
        g.ignite_at(fz.location.lat, fz.location.lng, radius_cells=1)
    state.last_optimizer_fire_count = g.burning_count()
    return {"ok": True, "tick": 0, "burning_count": g.burning_count()}


# ---------------------------------------------------------------------------
# FIRMS data endpoint
# ---------------------------------------------------------------------------

@router.get("/firms")
def get_firms_data(live: bool = False):
    """Return FIRMS hotspot GeoJSON. live=true requires FIRMS_MAP_KEY env var."""
    import os, asyncio
    from nasa_firms import load_cached, fetch_live
    if live:
        key = os.getenv("FIRMS_MAP_KEY")
        if not key:
            raise HTTPException(status_code=503, detail="FIRMS_MAP_KEY env var not set")
        return asyncio.run(fetch_live(key))
    return load_cached()


# ---------------------------------------------------------------------------
# Fire zone CRUD
# ---------------------------------------------------------------------------

@router.get("/")
def list_fires(active_only: bool = False, op: Operator = Depends(get_operator)) -> list[dict]:
    zones = [fz for fz in state.fire_zones.values() if not active_only or fz.active]
    return filters.filter_fires(zones, op)


@router.get("/{fire_id}", response_model=FireZone)
def get_fire(fire_id: str) -> FireZone:
    if fire_id not in state.fire_zones:
        raise HTTPException(status_code=404, detail="Fire zone not found")
    return state.fire_zones[fire_id]


@router.post("/", status_code=201)
def create_fire(fire: FireZone) -> FireZone:
    if fire.id in state.fire_zones:
        raise HTTPException(status_code=409, detail="Fire zone ID already exists")
    state.fire_zones[fire.id] = fire
    return fire


@router.put("/{fire_id}")
def update_fire(fire_id: str, fire: FireZone) -> FireZone:
    if fire_id not in state.fire_zones:
        raise HTTPException(status_code=404, detail="Fire zone not found")
    state.fire_zones[fire_id] = fire
    return fire


@router.delete("/{fire_id}", status_code=204)
def delete_fire(fire_id: str) -> None:
    if fire_id not in state.fire_zones:
        raise HTTPException(status_code=404, detail="Fire zone not found")
    del state.fire_zones[fire_id]


# ---------------------------------------------------------------------------
# Internal helper — called by background task and manual tick endpoint
# ---------------------------------------------------------------------------

def sync_fire_zones() -> None:
    """
    Update fire zone severity and radiusM based on current simulation state.
    Called after each tick so the optimizer sees meaningful, changing inputs.
    """
    g = state.fire_grid
    if g is None:
        return
    for fz_id, fz in list(state.fire_zones.items()):
        r, c = latLng_to_cell(fz.location.lat, fz.location.lng)
        burning_nearby = sum(
            1
            for dr in range(-4, 5)
            for dc in range(-4, 5)
            if 0 <= r + dr < g.rows and 0 <= c + dc < g.cols
            and g.cells[r + dr][c + dc] == BURNING
        )
        updates: dict = {}
        new_radius = max(fz.radiusM, 180 + burning_nearby * 35)
        if new_radius != fz.radiusM:
            updates["radiusM"] = new_radius
        if burning_nearby >= 8 and fz.severity != Priority.critical:
            updates["severity"] = Priority.critical
        elif burning_nearby >= 4 and fz.severity == Priority.normal:
            updates["severity"] = Priority.high
        if updates:
            state.fire_zones[fz_id] = fz.model_copy(update=updates)
