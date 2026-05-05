import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from models import (
    Mission, Operator, OperatorRole, Event,
    MissionRequest, MissionRequestCreate, MissionApprove, MissionRequestStatus,
    TightestConstraint,
)
from deps import get_operator
import filters
import state

router = APIRouter(prefix="/missions", tags=["missions"])


@router.get("/")
def list_missions(op: Operator = Depends(get_operator)) -> list[dict]:
    return filters.filter_missions(list(state.missions.values()), op)


@router.get("/requests/")
def list_requests(op: Operator = Depends(get_operator)) -> list[dict]:
    return filters.filter_mission_requests(list(state.mission_requests.values()), op)


@router.post("/requests/", status_code=201)
def submit_request(body: MissionRequestCreate, op: Operator = Depends(get_operator)) -> MissionRequest:
    req = MissionRequest(
        id=f"REQ-{uuid.uuid4().hex[:6].upper()}",
        requested_by=op.id,
        submitted_at=datetime.now().strftime("%H:%M"),
        location=body.location,
        volume=body.volume,
        duration=body.duration,
        notes=body.notes,
    )
    state.mission_requests[req.id] = req
    state.events.insert(0, Event(
        id=str(uuid.uuid4()), ts=req.submitted_at, type="mission_requested",
        message=f"Mission request {req.id} submitted by {op.name}",
    ))
    if len(state.events) > 30:
        state.events = state.events[:30]
    return req


@router.post("/requests/{request_id}/approve")
def approve_request(
    request_id: str,
    body: MissionApprove = MissionApprove(),
    op: Operator = Depends(get_operator),
) -> Mission:
    if op.role == OperatorRole.pilot:
        raise HTTPException(status_code=403, detail="Only commanders can approve requests")
    req = state.mission_requests.get(request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != MissionRequestStatus.pending:
        raise HTTPException(status_code=409, detail=f"Request is already {req.status}")

    mission_id = f"M-{uuid.uuid4().hex[:6].upper()}"
    tightest = body.tightest or TightestConstraint(drone="TBD", timeFlex=0, spatialFlex=0)
    now = datetime.now().strftime("%H:%M")
    mission = Mission(
        id=mission_id, status="pending",
        startTime=now, duration=req.duration,
        location=req.location, volume=req.volume, tightest=tightest,
    )
    state.missions[mission_id] = mission

    state.mission_requests[request_id] = req.model_copy(update={
        "status": MissionRequestStatus.approved,
        "mission_id": mission_id,
        "reviewed_by": op.id,
        "reviewed_at": now,
    })

    state.events.insert(0, Event(
        id=str(uuid.uuid4()), ts=now, type="mission_approved",
        message=f"Request {request_id} approved by {op.name} → Mission {mission_id} created",
    ))
    if len(state.events) > 30:
        state.events = state.events[:30]
    return mission


@router.post("/requests/{request_id}/reject")
def reject_request(request_id: str, op: Operator = Depends(get_operator)) -> MissionRequest:
    if op.role == OperatorRole.pilot:
        raise HTTPException(status_code=403, detail="Only commanders can reject requests")
    req = state.mission_requests.get(request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != MissionRequestStatus.pending:
        raise HTTPException(status_code=409, detail=f"Request is already {req.status}")
    now = datetime.now().strftime("%H:%M")
    updated = req.model_copy(update={
        "status": MissionRequestStatus.rejected,
        "reviewed_by": op.id,
        "reviewed_at": now,
    })
    state.mission_requests[request_id] = updated
    state.events.insert(0, Event(
        id=str(uuid.uuid4()), ts=now, type="mission_rejected",
        message=f"Request {request_id} rejected by {op.name}",
    ))
    if len(state.events) > 30:
        state.events = state.events[:30]
    return updated


@router.get("/{mission_id}")
def get_mission(mission_id: str) -> Mission:
    if mission_id not in state.missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    return state.missions[mission_id]


@router.post("/", status_code=201)
def create_mission(mission: Mission, op: Operator = Depends(get_operator)) -> Mission:
    if op.role == OperatorRole.pilot:
        raise HTTPException(status_code=403, detail="Pilots must use POST /missions/requests/")
    if mission.id in state.missions:
        raise HTTPException(status_code=409, detail="Mission ID already exists")
    state.missions[mission.id] = mission
    return mission


@router.put("/{mission_id}")
def update_mission(mission_id: str, mission: Mission, op: Operator = Depends(get_operator)) -> Mission:
    if op.role == OperatorRole.pilot:
        raise HTTPException(status_code=403, detail="Pilots cannot modify missions directly")
    if mission_id not in state.missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    state.missions[mission_id] = mission
    return mission


@router.delete("/{mission_id}", status_code=204)
def delete_mission(mission_id: str, op: Operator = Depends(get_operator)) -> None:
    if op.role == OperatorRole.pilot:
        raise HTTPException(status_code=403, detail="Pilots cannot delete missions")
    if mission_id not in state.missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    del state.missions[mission_id]
