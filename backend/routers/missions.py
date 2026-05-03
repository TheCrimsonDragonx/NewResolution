from fastapi import APIRouter, HTTPException
from models import Mission
import state

router = APIRouter(prefix="/missions", tags=["missions"])


@router.get("/")
def list_missions() -> list[Mission]:
    return list(state.missions.values())


@router.get("/{mission_id}")
def get_mission(mission_id: str) -> Mission:
    if mission_id not in state.missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    return state.missions[mission_id]


@router.post("/", status_code=201)
def create_mission(mission: Mission) -> Mission:
    if mission.id in state.missions:
        raise HTTPException(status_code=409, detail="Mission ID already exists")
    state.missions[mission.id] = mission
    return mission


@router.put("/{mission_id}")
def update_mission(mission_id: str, mission: Mission) -> Mission:
    if mission_id not in state.missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    state.missions[mission_id] = mission
    return mission


@router.delete("/{mission_id}", status_code=204)
def delete_mission(mission_id: str) -> None:
    if mission_id not in state.missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    del state.missions[mission_id]
