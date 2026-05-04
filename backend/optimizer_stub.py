"""
optimizer_stub.py — Drone assignment + 4D trajectory deconfliction.

Bridges our state model to algo.py (Stollenwerk QUBO formulation):
  1. Greedy pre-assignment: rank drones → fire zones by priority + battery
  2. Build algo.Request objects — convert each assignment to a 4D flight volume
  3. Run solve_wildfire() — QUBO finds conflict-free trajectories
  4. Translate result back to OptimizerResult

Falls back to the greedy result if algo.py or dwave-samplers is unavailable.
"""
from __future__ import annotations
import math
import os
import sys
import uuid

from models import OptimizerResult, AssignmentResult
import state

# ---------------------------------------------------------------------------
# Flat-Earth projection centered on Salinas test site (~3 km radius, <0.1% error)
# ---------------------------------------------------------------------------
_CENTER_LAT = 36.5124
_CENTER_LNG = -121.5365
_LAT_M      = 111_320.0
_LNG_M      = 111_320.0 * math.cos(math.radians(_CENTER_LAT))


def _to_xy(lat: float, lng: float) -> tuple[float, float]:
    return (lng - _CENTER_LNG) * _LNG_M, (lat - _CENTER_LAT) * _LAT_M


def _dist_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    x1, y1 = _to_xy(lat1, lng1)
    x2, y2 = _to_xy(lat2, lng2)
    return math.hypot(x2 - x1, y2 - y1)


# ---------------------------------------------------------------------------
# Priority helpers
# ---------------------------------------------------------------------------
_SEV_WEIGHT = {"critical": 3, "high": 2, "normal": 1}
_DRONE_SPEED_M_PER_MIN = 800.0   # ~48 km/h cruise
_MISSION_DURATION_MIN  = 20.0    # minutes on station per assignment


# ---------------------------------------------------------------------------
# Main entry point — called by routers/optimizer.py
# ---------------------------------------------------------------------------

def run_optimizer(
    drone_ids: list[str] | None,
    fire_zone_ids: list[str] | None,
) -> OptimizerResult:

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
            status="ok",
            message="No assignable drones or active fire zones.",
            assignments=[],
            totalCoverage=0.0,
            runId=str(uuid.uuid4()),
        )

    # ------------------------------------------------------------------
    # Step 1: greedy pre-assignment — highest-severity fire zones first,
    # highest-battery available drones first
    # ------------------------------------------------------------------
    sorted_targets = sorted(
        targets,
        key=lambda fz: _SEV_WEIGHT.get(fz.severity.value, 0),
        reverse=True,
    )
    sorted_drones = sorted(candidates, key=lambda d: d.battery, reverse=True)

    pre: list[tuple] = []   # [(drone, fire_zone), ...]
    used: set[str] = set()
    for fz in sorted_targets:
        for d in sorted_drones:
            if d.id not in used:
                pre.append((d, fz))
                used.add(d.id)
                break

    if not pre:
        return OptimizerResult(
            status="ok",
            message="Could not form any assignments.",
            assignments=[],
            totalCoverage=0.0,
            runId=str(uuid.uuid4()),
        )

    # ------------------------------------------------------------------
    # Step 2: try to load algo.py (lives one directory above backend/)
    # ------------------------------------------------------------------
    _repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _repo_root not in sys.path:
        sys.path.insert(0, _repo_root)

    try:
        from algo import (
            Request, Volume,
            Priority as AlgoPriority,
            Constraint,
            solve_wildfire,
        )
    except ImportError:
        return _greedy_fallback(pre, targets, note="algo.py not found")

    # ------------------------------------------------------------------
    # Step 3: convert assignments → algo.Request objects
    # ------------------------------------------------------------------
    _prio_map = {
        "critical": AlgoPriority.HIGH,
        "high":     AlgoPriority.MEDIUM,
        "normal":   AlgoPriority.LOW,
    }

    requests = []
    fz_by_drone: dict[str, object] = {}

    for drone, fz in pre:
        x, y = _to_xy(fz.location.lat, fz.location.lng)
        radius = float(fz.radiusM)
        dist   = _dist_m(
            drone.position.lat, drone.position.lng,
            fz.location.lat,    fz.location.lng,
        )
        eta = dist / _DRONE_SPEED_M_PER_MIN

        requests.append(Request(
            drone_id=drone.id,
            volume=Volume(
                x=x, y=y,
                x_range=radius, y_range=radius,
                z_min=200.0, z_max=600.0,
                t_start=eta,
                t_end=eta + _MISSION_DURATION_MIN,
            ),
            priority=_prio_map[fz.severity.value],
        ))
        fz_by_drone[drone.id] = fz

    # ------------------------------------------------------------------
    # Step 4: run QUBO deconfliction (SA solver, no quantum hardware needed)
    # ------------------------------------------------------------------
    try:
        result = solve_wildfire(requests, constraints=[], num_alternatives=8, use_quantum=False)
    except Exception as e:
        return _greedy_fallback(pre, targets, note=str(e))

    # ------------------------------------------------------------------
    # Step 5: translate back to OptimizerResult
    # ------------------------------------------------------------------
    assignments = []
    for drone_id, cand_idx in result["qubo_assignments"].items():
        fz     = fz_by_drone.get(drone_id)
        drone  = state.drones.get(drone_id)
        if fz is None or drone is None:
            continue
        vol    = result["all_candidates"][drone_id][cand_idx]
        score  = round(_SEV_WEIGHT.get(fz.severity.value, 1) * (drone.battery / 100), 3)
        assignments.append(AssignmentResult(
            droneId=drone_id,
            fireZoneId=fz.id,
            priorityScore=score,
            etaMinutes=round(vol.t_start, 1),
        ))

    coverage = round(min(1.0, len(assignments) / max(1, len(targets))), 2)
    r = result
    message = (
        f"QUBO: {r['qubo_assigned']}/{len(requests)} assigned · "
        f"{r['qubo_conflicts']} conflicts · "
        f"{r['qubo_time']:.2f}s · "
        f"cost {r['qubo_cost']:.1f} vs greedy {r['greedy_cost']:.1f}"
    )

    return OptimizerResult(
        status="qubo",
        message=message,
        assignments=assignments,
        totalCoverage=coverage,
        runId=str(uuid.uuid4()),
    )


# ---------------------------------------------------------------------------
# Greedy fallback — used when algo.py or dwave-samplers is unavailable
# ---------------------------------------------------------------------------

def _greedy_fallback(
    pre: list[tuple],
    targets: list,
    note: str = "",
) -> OptimizerResult:
    assignments = []
    for i, (drone, fz) in enumerate(pre):
        score = round(_SEV_WEIGHT.get(fz.severity.value, 1) * (drone.battery / 100), 3)
        dist  = _dist_m(
            drone.position.lat, drone.position.lng,
            fz.location.lat,    fz.location.lng,
        )
        eta = round(dist / _DRONE_SPEED_M_PER_MIN, 1)
        assignments.append(AssignmentResult(
            droneId=drone.id,
            fireZoneId=fz.id,
            priorityScore=score,
            etaMinutes=eta,
        ))
    coverage = round(min(1.0, len(assignments) / max(1, len(targets))), 2)
    msg = "Greedy fallback" + (f" — {note}" if note else "")
    return OptimizerResult(
        status="greedy",
        message=msg,
        assignments=assignments,
        totalCoverage=coverage,
        runId=str(uuid.uuid4()),
    )
