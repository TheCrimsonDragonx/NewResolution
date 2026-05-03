"""
In-memory state store. All data lives here for the lifetime of the process.
Nothing is persisted to disk, sent to a database, or sent to any external service.
"""
from __future__ import annotations
import uuid
from models import (
    Region, Event, Mission, Location, Volume, TightestConstraint,
    Drone, DronePosition, FireZone, MeshStatus,
    Priority, DroneStatus, ConnectionStatus,
)

regions: dict[str, Region] = {}
events: list[Event] = []
missions: dict[str, Mission] = {}
drones: dict[str, Drone] = {}
fire_zones: dict[str, FireZone] = {}
mesh: MeshStatus = MeshStatus(
    radio=ConnectionStatus.ok,
    pingStation=ConnectionStatus.ok,
    network=ConnectionStatus.ok,
)


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

    # Fire zones — correspond to red circles in the dashboard map
    for fz in [
        FireZone(id="FIRE-01", location=Location(lat=36.5200, lng=-121.5280),
                 severity=Priority.critical, radiusM=450, spreadRate=3.2),
        FireZone(id="FIRE-02", location=Location(lat=36.5180, lng=-121.5240),
                 severity=Priority.critical, radiusM=380, spreadRate=2.8),
        FireZone(id="FIRE-03", location=Location(lat=36.5110, lng=-121.5350),
                 severity=Priority.high,     radiusM=220, spreadRate=1.1),
    ]:
        fire_zones[fz.id] = fz

    # Mesh — matches dashboard MOCK_MESH
    global mesh
    mesh = MeshStatus(
        radio=ConnectionStatus.warning,
        pingStation=ConnectionStatus.ok,
        network=ConnectionStatus.ok,
    )
