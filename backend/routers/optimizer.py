from fastapi import APIRouter, Depends, HTTPException
from models import OptimizerRequest, OptimizerResult, Operator, OperatorRole
from optimizer_stub import run_optimizer
from deps import get_operator

router = APIRouter(prefix="/optimizer", tags=["optimizer"])

_last_result: OptimizerResult | None = None


@router.post("/run")
def trigger_optimizer(
    request: OptimizerRequest = OptimizerRequest(),
    op: Operator = Depends(get_operator),
) -> dict:
    if op.role == OperatorRole.observer:
        raise HTTPException(status_code=403, detail="Optimizer access requires Commander or Pilot role")
    global _last_result
    _last_result = run_optimizer(request.drones, request.fireZones)
    if op.role == OperatorRole.pilot:
        filtered = [a for a in _last_result.assignments if a.droneId == op.assigned_drone_id]
        return {**_last_result.model_dump(), "assignments": [a.model_dump() for a in filtered]}
    return _last_result.model_dump()


@router.get("/status")
def optimizer_status(op: Operator = Depends(get_operator)) -> dict:
    if _last_result is None:
        if op.role == OperatorRole.observer:
            return {"status": "idle"}
        return {"status": "idle", "message": "No run yet. POST /optimizer/run to trigger."}
    if op.role == OperatorRole.observer:
        return {"status": _last_result.status, "runId": _last_result.runId}
    return {
        "status": _last_result.status,
        "runId": _last_result.runId,
        "totalCoverage": _last_result.totalCoverage,
        "message": _last_result.message,
    }


@router.get("/last-result")
def last_result(op: Operator = Depends(get_operator)) -> dict:
    if op.role == OperatorRole.observer:
        raise HTTPException(status_code=403, detail="Optimizer detail access requires Commander or Pilot role")
    if _last_result is None:
        return {"status": "idle", "assignments": []}
    if op.role == OperatorRole.pilot:
        filtered = [a for a in _last_result.assignments if a.droneId == op.assigned_drone_id]
        return {**_last_result.model_dump(), "assignments": [a.model_dump() for a in filtered]}
    return _last_result.model_dump()
