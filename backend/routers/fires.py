from fastapi import APIRouter, HTTPException
from models import FireZone
import state

router = APIRouter(prefix="/fires", tags=["fires"])


@router.get("/")
def list_fires(active_only: bool = False) -> list[FireZone]:
    zones = state.fire_zones.values()
    if active_only:
        return [fz for fz in zones if fz.active]
    return list(zones)


@router.get("/{fire_id}")
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
