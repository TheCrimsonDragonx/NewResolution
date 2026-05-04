import asyncio
import os
import sys
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from models import OptimizerRequest, OptimizerResult, Operator, OperatorRole
from optimizer_stub import run_optimizer
from deps import get_operator

router = APIRouter(prefix="/optimizer", tags=["optimizer"])

_last_result: OptimizerResult | None = None


@router.post("/run")
async def trigger_optimizer(
    request: OptimizerRequest = OptimizerRequest(),
    op: Operator = Depends(get_operator),
) -> dict:
    if op.role in (OperatorRole.atgs, OperatorRole.dispatch):
        raise HTTPException(status_code=403, detail="Optimizer trigger requires Commander or Pilot role")
    global _last_result
    # Run QUBO in a thread — keeps the event loop free for poll requests during the ~4s solve
    _last_result = await asyncio.to_thread(run_optimizer, request.drones, request.fireZones)
    if op.role == OperatorRole.pilot:
        filtered = [a for a in _last_result.assignments if a.droneId == op.assigned_drone_id]
        return {**_last_result.model_dump(), "assignments": [a.model_dump() for a in filtered]}
    return _last_result.model_dump()


@router.get("/status")
def optimizer_status(op: Operator = Depends(get_operator)) -> dict:
    if _last_result is None:
        return {"status": "idle", "message": "No run yet. POST /optimizer/run to trigger."}
    return {
        "status": _last_result.status,
        "runId": _last_result.runId,
        "totalCoverage": _last_result.totalCoverage,
        "message": _last_result.message,
    }


@router.get("/benchmark")
def run_benchmark(op: Operator = Depends(get_operator)) -> dict:
    """
    Fleet-size scalability sweep: run QUBO deconfliction at 5/10/15/20/25/30 aircraft
    in a fixed 3 km × 3 km airspace volume and return QUBO vs. greedy comparison data.
    Runs synchronously (~5–10 s). Commander role required.
    """
    if op.role != OperatorRole.commander:
        raise HTTPException(status_code=403, detail="Benchmark requires Commander role")

    _repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if _repo_root not in sys.path:
        sys.path.insert(0, _repo_root)

    try:
        from algo import Request, Volume, Priority as AP, Constraint, solve_wildfire
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"algo.py unavailable: {e}")

    constraints = [Constraint("ridge_line", Volume(0, 0, 2000, 500, 0, 800, 0, 480))]
    pri_cycle   = [AP.HIGH, AP.MEDIUM, AP.LOW]
    rows = []

    for n in [5, 10, 15, 20, 25, 30]:
        np.random.seed(42)
        requests = [
            Request(
                drone_id=f"BM-{i:02d}",
                volume=Volume(
                    np.random.uniform(-3000, 3000),
                    np.random.uniform(-3000, 3000),
                    np.random.uniform(300, 600),
                    np.random.uniform(300, 600),
                    np.random.uniform(300, 500),
                    np.random.uniform(600, 900),
                    np.random.uniform(0, 30),
                    np.random.uniform(60, 120),
                ),
                priority=pri_cycle[i % 3],
            )
            for i in range(n)
        ]
        try:
            r = solve_wildfire(requests, constraints, num_alternatives=10, use_quantum=False)
            rows.append({
                "n_drones":          n,
                "initial_conflicts": r["initial_conflicts"],
                "greedy_assigned":   r["greedy_assigned"],
                "greedy_conflicts":  r["greedy_conflicts"],
                "greedy_cost":       round(r["greedy_cost"], 1),
                "qubo_assigned":     r["qubo_assigned"],
                "qubo_conflicts":    r["qubo_conflicts"],
                "qubo_cost":         round(r["qubo_cost"], 1),
                "qubo_time_s":       round(r["qubo_time"], 3),
            })
        except Exception as e:
            rows.append({"n_drones": n, "error": str(e)})

    return {
        "rows": rows,
        "area_m": 6000,
        "num_alternatives": 10,
        "solver": "simulated_annealing",
        "gps_degraded_note": "In GPS-denied mode, positions degrade to last-known + velocity extrapolation; deconfliction volumes expand by 1.5× to account for position uncertainty",
    }


@router.get("/last-result")
def last_result(op: Operator = Depends(get_operator)) -> dict:
    if _last_result is None:
        return {"status": "idle", "assignments": []}
    if op.role == OperatorRole.pilot:
        filtered = [a for a in _last_result.assignments if a.droneId == op.assigned_drone_id]
        return {**_last_result.model_dump(), "assignments": [a.model_dump() for a in filtered]}
    return _last_result.model_dump()
