from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel


class Priority(str, Enum):
    critical = "critical"
    high = "high"
    normal = "normal"


class OperatorRole(str, Enum):
    commander = "commander"
    pilot     = "pilot"
    observer  = "observer"


class DroneStatus(str, Enum):
    idle = "idle"
    active = "active"
    returning = "returning"
    grounded = "grounded"


class ConnectionStatus(str, Enum):
    ok = "ok"
    warning = "warning"
    critical = "critical"
    offline = "offline"


# ---------------------------------------------------------------------------
# Core domain models
# Field names match the JSON shape the frontend dashboard expects.
# ---------------------------------------------------------------------------

class Region(BaseModel):
    id: str
    name: str
    priority: Priority
    weight: int


class Event(BaseModel):
    id: str
    ts: str
    type: str
    message: str


class Location(BaseModel):
    lat: float
    lng: float


class Volume(BaseModel):
    width: float      # nmi
    height: float     # nmi
    minAlt: int       # ft
    maxAlt: int       # ft


class TightestConstraint(BaseModel):
    drone: str
    timeFlex: int     # minutes
    spatialFlex: int  # meters


class Mission(BaseModel):
    id: str
    status: str
    startTime: str
    duration: int     # minutes
    location: Location
    volume: Volume
    tightest: TightestConstraint


class DronePosition(BaseModel):
    lat: float
    lng: float
    alt: int          # feet AGL


class Drone(BaseModel):
    id: str
    name: str
    status: DroneStatus
    position: DronePosition
    battery: int      # 0–100 %
    payload: str      # e.g. "thermal_camera", "water_drop", "sensor_array"


class FireZone(BaseModel):
    id: str
    location: Location
    severity: Priority
    radiusM: int      # meters
    spreadRate: float # km/h
    active: bool = True
    region_id: Optional[str] = None


class Operator(BaseModel):
    id: str
    name: str
    role: OperatorRole
    assigned_drone_id:  Optional[str] = None
    assigned_region_id: Optional[str] = None


class MeshStatus(BaseModel):
    radio: ConnectionStatus
    pingStation: ConnectionStatus
    network: ConnectionStatus


# ---------------------------------------------------------------------------
# Optimizer I/O models
# ---------------------------------------------------------------------------

class SimBounds(BaseModel):
    lat_min: float
    lat_max: float
    lng_min: float
    lng_max: float


class SimState(BaseModel):
    tick: int
    rows: int
    cols: int
    wind_deg: float
    wind_speed: float
    burning_count: int
    burnt_count: int
    cells: list[list[int]]   # rows × cols, values: 0=empty 1=burning 2=burnt
    bounds: SimBounds


class OptimizerRequest(BaseModel):
    drones: Optional[list[str]] = None      # drone IDs to consider; None = all available
    fireZones: Optional[list[str]] = None   # fire zone IDs to target; None = all active


class AssignmentResult(BaseModel):
    droneId: str
    fireZoneId: str
    priorityScore: float
    etaMinutes: float


class OptimizerResult(BaseModel):
    status: str        # "stub" | "running" | "complete"
    message: str
    assignments: list[AssignmentResult]
    totalCoverage: float  # 0.0–1.0
    runId: str
