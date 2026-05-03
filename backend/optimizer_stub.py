"""
optimizer_stub.py — Placeholder drone assignment optimizer.

HOW TO PLUG IN THE REAL ALGORITHM
----------------------------------
1. Replace the body of `run_optimizer()` below with your algorithm.
2. The function signature and return type (OptimizerResult) must stay the same
   so the router keeps working without changes.
3. The rest of the backend (state, models, routers) does not need to change.

WHAT THE REAL ALGORITHM SHOULD DO
----------------------------------
Inputs (available via the `state` module):
    state.drones      — current drone positions, battery, payload, status
    state.fire_zones  — active fire zones with severity, location, spread rate
    state.regions     — priority/weight map for geographic zones
    state.missions    — active mission constraints (volume, timing)

Outputs (OptimizerResult):
    assignments       — list of (drone → fire zone) pairings with ETA + score
    totalCoverage     — fraction of active fire zones that have a drone assigned
"""
from __future__ import annotations
import uuid
from models import OptimizerResult, AssignmentResult
import state

_PRIORITY_WEIGHT = {"critical": 3, "high": 2, "normal": 1}


def run_optimizer(
    drone_ids: list[str] | None,
    fire_zone_ids: list[str] | None,
) -> OptimizerResult:
    """
    TODO: Replace this stub body with the real optimization algorithm.

    Current behavior: naive priority-sorted round-robin pairing so the
    frontend has something real-looking to display.
    """

    candidates = [
        d for d in state.drones.values()
        if d.status not in ("grounded",)
        and (drone_ids is None or d.id in drone_ids)
    ]
    targets = [
        fz for fz in state.fire_zones.values()
        if fz.active
        and (fire_zone_ids is None or fz.id in fire_zone_ids)
    ]

    if not candidates or not targets:
        return OptimizerResult(
            status="stub",
            message="[STUB] No assignable drones or active fire zones.",
            assignments=[],
            totalCoverage=0.0,
            runId=str(uuid.uuid4()),
        )

    # Sort fire zones highest priority first
    sorted_targets = sorted(
        targets,
        key=lambda fz: _PRIORITY_WEIGHT.get(fz.severity, 0),
        reverse=True,
    )

    assignments: list[AssignmentResult] = []
    for i, fz in enumerate(sorted_targets):
        if i >= len(candidates):
            break
        drone = candidates[i % len(candidates)]
        score = round(_PRIORITY_WEIGHT.get(fz.severity, 1) * (drone.battery / 100), 3)
        assignments.append(AssignmentResult(
            droneId=drone.id,
            fireZoneId=fz.id,
            priorityScore=score,
            etaMinutes=round(3.0 + i * 2.5, 1),   # placeholder — replace with real distance calc
        ))

    coverage = round(min(1.0, len(assignments) / max(1, len(sorted_targets))), 2)

    return OptimizerResult(
        status="stub",
        message="[STUB] Round-robin placeholder — replace optimizer_stub.run_optimizer() with real algorithm.",
        assignments=assignments,
        totalCoverage=coverage,
        runId=str(uuid.uuid4()),
    )
