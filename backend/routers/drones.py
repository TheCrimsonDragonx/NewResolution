from fastapi import APIRouter, HTTPException, Depends
from models import Drone, Operator
from deps import get_operator
import filters
import state

router = APIRouter(prefix="/drones", tags=["drones"])


@router.get("/")
def list_drones(op: Operator = Depends(get_operator)) -> list[dict]:
    return filters.filter_drones(list(state.drones.values()), op)


@router.get("/{drone_id}")
def get_drone(drone_id: str) -> Drone:
    if drone_id not in state.drones:
        raise HTTPException(status_code=404, detail="Drone not found")
    return state.drones[drone_id]


@router.post("/", status_code=201)
def create_drone(drone: Drone) -> Drone:
    if drone.id in state.drones:
        raise HTTPException(status_code=409, detail="Drone ID already exists")
    state.drones[drone.id] = drone
    return drone


@router.put("/{drone_id}")
def update_drone(drone_id: str, drone: Drone) -> Drone:
    if drone_id not in state.drones:
        raise HTTPException(status_code=404, detail="Drone not found")
    state.drones[drone_id] = drone
    return drone


@router.delete("/{drone_id}", status_code=204)
def delete_drone(drone_id: str) -> None:
    if drone_id not in state.drones:
        raise HTTPException(status_code=404, detail="Drone not found")
    del state.drones[drone_id]
