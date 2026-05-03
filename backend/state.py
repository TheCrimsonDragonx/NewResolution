"""
In-memory state store. All data lives here for the lifetime of the process.
Nothing is persisted to disk, sent to a database, or sent to any external service.
"""
from __future__ import annotations
import uuid
from typing import Optional
from models import (
    Region, Event, Mission, Location, Volume, TightestConstraint,
    Drone, DronePosition, FireZone, MeshStatus,
    Priority, DroneStatus, ConnectionStatus,
    Operator, OperatorRole,
)
from fire_sim import FireGrid

regions: dict[str, Region] = {}
events: list[Event] = []
missions: dict[str, Mission] = {}
drones: dict[str, Drone] = {}
fire_zones: dict[str, FireZone] = {}
operators: dict[str, Operator] = {}
mesh: MeshStatus = MeshStatus(
    radio=ConnectionStatus.ok,
    pingStation=ConnectionStatus.ok,
    network=ConnectionStatus.ok,
)
fire_grid: Optional[FireGrid] = None
last_optimizer_fire_count: int = 0


def seed() -> None:
    """Populate the store with realistic seed data matching the dashboard's MOCK_* values."""

    # Regions — matches dashboard MOCK_REGIONS
    for r in [
        Region(id="east", name="east", priority=Priority.critical, weight=10),
        Region(id="mid",  name="mid",  priority=Priority.high,     weight=3),
        Region(id="west", name="west", priority=Priority.normal,   weight=1),
    ]:
        regions[r.id] = r

    # Events — matches dashboard MOCK_EVENTS
    for ev in [
        Event(id=str(uuid.uuid4()), ts="11:09", type="drone_refueling",
              message="UAS-07 refueling · backup assigned"),
        Event(id=str(uuid.uuid4()), ts="11:08", type="mission_completed",
              message="H-12 mission completed"),
        Event(id=str(uuid.uuid4()), ts="11:07", type="priority_changed",
              message="IC priority change · east → critical"),
        Event(id=str(uuid.uuid4()), ts="11:05", type="drone_disconnected",
              message="UAS-09 disconnected · last seen tracked"),
    ]:
        events.append(ev)

    # Mission UR31 — matches dashboard MOCK_MISSION
    m = Mission(
        id="UR31",
        status="active",
        startTime="11:10",
        duration=30,
        location=Location(lat=36.5124, lng=-121.5365),
        volume=Volume(width=0.67, height=0.87, minAlt=0, maxAlt=1145),
        tightest=TightestConstraint(drone="UAS-04", timeFlex=5, spatialFlex=100),
    )
    missions[m.id] = m

    # Drones — UAS fleet at Salinas test site
    for d in [
        Drone(id="UAS-04", name="UAS-04", status=DroneStatus.active,
              position=DronePosition(lat=36.5140, lng=-121.5340, alt=400),
              battery=78, payload="thermal_camera"),
        Drone(id="UAS-07", name="UAS-07", status=DroneStatus.grounded,
              position=DronePosition(lat=36.5100, lng=-121.5380, alt=0),
              battery=12, payload="water_drop"),
        Drone(id="UAS-09", name="UAS-09", status=DroneStatus.grounded,
              position=DronePosition(lat=36.5160, lng=-121.5400, alt=0),
              battery=0,  payload="sensor_array"),
        Drone(id="UAS-11", name="UAS-11", status=DroneStatus.idle,
              position=DronePosition(lat=36.5120, lng=-121.5300, alt=0),
              battery=95, payload="thermal_camera"),
        Drone(id="UAS-12", name="UAS-12", status=DroneStatus.returning,
              position=DronePosition(lat=36.5180, lng=-121.5320, alt=800),
              battery=35, payload="water_drop"),
    ]:
        drones[d.id] = d

    # Fire zones — tagged with region_id for pilot scoping
    for fz in [
        FireZone(id="FIRE-01", location=Location(lat=36.5200, lng=-121.5280),
                 severity=Priority.critical, radiusM=450, spreadRate=3.2, region_id="east"),
        FireZone(id="FIRE-02", location=Location(lat=36.5180, lng=-121.5240),
                 severity=Priority.critical, radiusM=380, spreadRate=2.8, region_id="east"),
        FireZone(id="FIRE-03", location=Location(lat=36.5110, lng=-121.5350),
                 severity=Priority.high,     radiusM=220, spreadRate=1.1, region_id="mid"),
    ]:
        fire_zones[fz.id] = fz

    # Operators — one per role, linked to existing seed data
    for op in [
        Operator(id="op-cmd-01", name="Commander Hayes", role=OperatorRole.commander),
        Operator(id="op-plt-04", name="Pilot Rivera",    role=OperatorRole.pilot,
                 assigned_drone_id="UAS-04", assigned_region_id="east"),
        Operator(id="op-obs-01", name="Observer Chen",   role=OperatorRole.observer),
    ]:
        operators[op.id] = op

    # Mesh — matches dashboard MOCK_MESH
    global mesh
    mesh = MeshStatus(
        radio=ConnectionStatus.warning,
        pingStation=ConnectionStatus.ok,
        network=ConnectionStatus.ok,
    )

    # Fire simulation — seed ignition points from FIRMS cache, then from fire zones
    global fire_grid, last_optimizer_fire_count
    fire_grid = FireGrid(wind_deg=225.0, wind_speed=20.0, p_base=0.28, burn_duration=5)
    from nasa_firms import load_cached, firms_ignition_points
    firms_data = load_cached()
    for lat, lng in firms_ignition_points(firms_data):
        fire_grid.ignite_at(lat, lng, radius_cells=0)
    # Also seed ignition at each fire zone center (in case FIRMS points are sparse)
    for fz in fire_zones.values():
        fire_grid.ignite_at(fz.location.lat, fz.location.lng, radius_cells=1)
    last_optimizer_fire_count = fire_grid.burning_count()
