from models import Drone, Mission, FireZone, Event, Operator, OperatorRole

_PUBLIC_EVENT_TYPES = {"mission_completed", "priority_changed"}


def filter_drones(drones: list[Drone], op: Operator) -> list[dict]:
    if op.role == OperatorRole.commander:
        return [d.model_dump() for d in drones]
    if op.role == OperatorRole.pilot:
        result = []
        for d in drones:
            if d.id == op.assigned_drone_id:
                result.append(d.model_dump())
            else:
                result.append({"id": d.id, "name": d.name, "status": d.status})
        return result
    # observer — fleet summary only
    total = len(drones)
    active    = sum(1 for d in drones if d.status == "active")
    returning = sum(1 for d in drones if d.status == "returning")
    grounded  = sum(1 for d in drones if d.status == "grounded")
    idle      = sum(1 for d in drones if d.status == "idle")
    return [{"summary": True, "total": total, "active": active,
             "returning": returning, "grounded": grounded, "idle": idle}]


def filter_missions(missions: list[Mission], op: Operator) -> list[dict]:
    if op.role == OperatorRole.commander:
        return [m.model_dump() for m in missions]
    if op.role == OperatorRole.pilot:
        result = []
        for m in missions:
            if m.tightest and m.tightest.drone == op.assigned_drone_id:
                result.append(m.model_dump())
            else:
                result.append({"id": m.id, "status": m.status})
        return result
    # observer — id + status only
    return [{"id": m.id, "status": m.status} for m in missions]


def filter_fires(fires: list[FireZone], op: Operator) -> list[dict]:
    if op.role == OperatorRole.commander:
        return [fz.model_dump() for fz in fires]
    if op.role == OperatorRole.pilot:
        result = []
        for fz in fires:
            if fz.region_id == op.assigned_region_id:
                result.append(fz.model_dump())
            else:
                d = fz.model_dump()
                d.pop("spreadRate", None)
                result.append(d)
        return result
    # observer — no spreadRate
    return [
        {"id": fz.id, "location": fz.location.model_dump(),
         "severity": fz.severity, "radiusM": fz.radiusM,
         "active": fz.active, "region_id": fz.region_id}
        for fz in fires
    ]


def filter_events(events: list[Event], op: Operator) -> list[dict]:
    if op.role == OperatorRole.commander:
        return [e.model_dump() for e in events]
    if op.role == OperatorRole.pilot:
        drone_id  = (op.assigned_drone_id  or "").lower()
        region_id = (op.assigned_region_id or "").lower()
        relevant = [
            e for e in events
            if (drone_id  and drone_id  in e.message.lower())
            or (region_id and region_id in e.message.lower())
        ]
        return [e.model_dump() for e in relevant]
    # observer — last 3 public event types only
    public = [e for e in events if e.type in _PUBLIC_EVENT_TYPES]
    return [e.model_dump() for e in public[-3:]]
