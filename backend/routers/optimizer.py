from fastapi import APIRouter
from models import OptimizerRequest, OptimizerResult
from optimizer_stub import run_optimizer

router = APIRouter(prefix="/optimizer", tags=["optimizer"])

_last_result: OptimizerResult | None = None


@router.post("/run")
def trigger_optimizer(request: OptimizerRequest = OptimizerRequest()) -> OptimizerResult:
    global _last_result
    _last_result = run_optimizer(request.drones, request.fireZones)
    return _last_result


@router.get("/status")
def optimizer_status() -> dict:
    if _last_result is None:
        return {"status": "idle", "message": "No run yet. POST /optimizer/run to trigger."}
    return {
        "status": _last_result.status,
        "runId": _last_result.runId,
        "totalCoverage": _last_result.totalCoverage,
        "message": _last_result.message,
    }


@router.get("/last-result")
def last_result() -> dict:
    if _last_result is None:
        return {"status": "idle", "assignments": []}
    return _last_result.model_dump()
