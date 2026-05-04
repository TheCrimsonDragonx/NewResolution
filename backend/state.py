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
current_assignments: dict[str, str] = {}   # drone_id → fire_zone_id
last_opt_message: str = ""


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

    # Drones — expanded UAS fleet at Salinas test site (~20 aircraft)
    for d in [
        # Existing core fleet
        Drone(id="UAS-04", name="UAS-04", status=DroneStatus.active,
              position=DronePosition(lat=36.5140, lng=-121.5340, alt=400),
              battery=89, payload="thermal_camera"),
        Drone(id="UAS-07", name="UAS-07", status=DroneStatus.grounded,
              position=DronePosition(lat=36.5100, lng=-121.5380, alt=0),
              battery=12, payload="suppression_asset"),
        Drone(id="UAS-09", name="UAS-09", status=DroneStatus.grounded,
              position=DronePosition(lat=36.5160, lng=-121.5400, alt=0),
              battery=0,  payload="sensor_array"),
        Drone(id="UAS-11", name="UAS-11", status=DroneStatus.idle,
              position=DronePosition(lat=36.5120, lng=-121.5300, alt=0),
              battery=95, payload="thermal_camera"),
        Drone(id="UAS-12", name="UAS-12", status=DroneStatus.returning,
              position=DronePosition(lat=36.5180, lng=-121.5320, alt=800),
              battery=35, payload="suppression_asset"),
        # Northern row
        Drone(id="UAS-01", name="UAS-01", status=DroneStatus.idle,
              position=DronePosition(lat=36.5270, lng=-121.5430, alt=0),
              battery=91, payload="thermal_camera"),
        Drone(id="UAS-02", name="UAS-02", status=DroneStatus.idle,
              position=DronePosition(lat=36.5270, lng=-121.5350, alt=0),
              battery=87, payload="sensor_array"),
        Drone(id="UAS-03", name="UAS-03", status=DroneStatus.active,
              position=DronePosition(lat=36.5270, lng=-121.5270, alt=450),
              battery=72, payload="thermal_camera"),
        Drone(id="UAS-05", name="UAS-05", status=DroneStatus.idle,
              position=DronePosition(lat=36.5250, lng=-121.5200, alt=0),
              battery=85, payload="sensor_array"),
        # Middle row
        Drone(id="UAS-06", name="UAS-06", status=DroneStatus.active,
              position=DronePosition(lat=36.5150, lng=-121.5420, alt=380),
              battery=68, payload="thermal_camera"),
        Drone(id="UAS-08", name="UAS-08", status=DroneStatus.idle,
              position=DronePosition(lat=36.5150, lng=-121.5300, alt=0),
              battery=93, payload="suppression_asset"),
        Drone(id="UAS-10", name="UAS-10", status=DroneStatus.returning,
              position=DronePosition(lat=36.5130, lng=-121.5220, alt=600),
              battery=28, payload="thermal_camera"),
        # Southern row
        Drone(id="UAS-13", name="UAS-13", status=DroneStatus.idle,
              position=DronePosition(lat=36.5030, lng=-121.5400, alt=0),
              battery=88, payload="sensor_array"),
        Drone(id="UAS-14", name="UAS-14", status=DroneStatus.active,
              position=DronePosition(lat=36.5030, lng=-121.5330, alt=420),
              battery=54, payload="thermal_camera"),
        Drone(id="UAS-15", name="UAS-15", status=DroneStatus.idle,
              position=DronePosition(lat=36.5030, lng=-121.5250, alt=0),
              battery=79, payload="suppression_asset"),
        Drone(id="UAS-16", name="UAS-16", status=DroneStatus.returning,
              position=DronePosition(lat=36.5020, lng=-121.5180, alt=500),
              battery=31, payload="sensor_array"),
        # Scatter
        Drone(id="UAS-17", name="UAS-17", status=DroneStatus.active,
              position=DronePosition(lat=36.5080, lng=-121.5380, alt=350),
              battery=61, payload="thermal_camera"),
        Drone(id="UAS-18", name="UAS-18", status=DroneStatus.idle,
              position=DronePosition(lat=36.5220, lng=-121.5160, alt=0),
              battery=94, payload="sensor_array"),
        Drone(id="UAS-19", name="UAS-19", status=DroneStatus.active,
              position=DronePosition(lat=36.5110, lng=-121.5230, alt=410),
              battery=47, payload="thermal_camera"),
        Drone(id="UAS-20", name="UAS-20", status=DroneStatus.returning,
              position=DronePosition(lat=36.5250, lng=-121.5400, alt=700),
              battery=22, payload="suppression_asset"),
    ]:
        drones[d.id] = d

    # Fire zones — tagged with region_id for pilot scoping (8 zones across the grid)
    for fz in [
        FireZone(id="FIRE-01", location=Location(lat=36.5200, lng=-121.5280),
                 severity=Priority.critical, radiusM=450, spreadRate=3.2, region_id="east"),
        FireZone(id="FIRE-02", location=Location(lat=36.5180, lng=-121.5240),
                 severity=Priority.critical, radiusM=380, spreadRate=2.8, region_id="east"),
        FireZone(id="FIRE-03", location=Location(lat=36.5110, lng=-121.5350),
                 severity=Priority.high,     radiusM=220, spreadRate=1.1, region_id="mid"),
        FireZone(id="FIRE-04", location=Location(lat=36.5030, lng=-121.5400),
                 severity=Priority.high,     radiusM=280, spreadRate=1.4, region_id="west"),
        FireZone(id="FIRE-05", location=Location(lat=36.5250, lng=-121.5270),
                 severity=Priority.high,     radiusM=310, spreadRate=1.7, region_id="mid"),
        FireZone(id="FIRE-06", location=Location(lat=36.5100, lng=-121.5170),
                 severity=Priority.critical, radiusM=400, spreadRate=2.5, region_id="east"),
        FireZone(id="FIRE-07", location=Location(lat=36.5180, lng=-121.5350),
                 severity=Priority.normal,   radiusM=190, spreadRate=0.8, region_id="mid"),
        FireZone(id="FIRE-08", location=Location(lat=36.5050, lng=-121.5250),
                 severity=Priority.high,     radiusM=260, spreadRate=1.3, region_id="west"),
    ]:
        fire_zones[fz.id] = fz

    # Operators — one per role, linked to existing seed data
    for op in [
        Operator(id="op-cmd-01", name="Commander Hayes", role=OperatorRole.commander),
        Operator(id="op-plt-04", name="Pilot Rivera",    role=OperatorRole.pilot,
                 assigned_drone_id="UAS-04", assigned_region_id="east"),
        Operator(id="op-atgs-01", name="ATGS Chen",       role=OperatorRole.atgs),
    ]:
        operators[op.id] = op

    # Mesh — all nodes start ok; degradation simulation takes over from tick 15
    global mesh
    mesh = MeshStatus(
        radio=ConnectionStatus.ok,
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
