"""
Cellular automaton fire spread simulation.

Grid: ROWS×COLS cells covering the Salinas test-site bounding box.
Each cell is approximately 100m × 100m.
State values: EMPTY=0, BURNING=1, BURNT=2

Wind direction biases the spread probability toward the downwind neighbors.
"""
from __future__ import annotations
import math
import random
from dataclasses import dataclass, field
from typing import List, Tuple

EMPTY   = 0
BURNING = 1
BURNT   = 2

# Geographic bounding box — matches the SVG map coordinate system
LAT_MIN, LAT_MAX = 36.500, 36.530   # 0.030 deg ≈ 3.3 km
LNG_MIN, LNG_MAX = -121.545, -121.515  # 0.030 deg ≈ 2.7 km
ROWS, COLS = 30, 30
_CELL_LAT = (LAT_MAX - LAT_MIN) / ROWS
_CELL_LNG = (LNG_MAX - LNG_MIN) / COLS


def latLng_to_cell(lat: float, lng: float) -> Tuple[int, int]:
    row = int((LAT_MAX - lat) / _CELL_LAT)
    col = int((lng - LNG_MIN) / _CELL_LNG)
    return max(0, min(ROWS - 1, row)), max(0, min(COLS - 1, col))


def cell_to_latLng(row: int, col: int) -> Tuple[float, float]:
    lat = LAT_MAX - (row + 0.5) * _CELL_LAT
    lng = LNG_MIN + (col + 0.5) * _CELL_LNG
    return lat, lng


@dataclass
class FireGrid:
    rows: int = ROWS
    cols: int = COLS
    wind_deg: float = 225.0   # SW wind → fire spreads toward NE
    wind_speed: float = 20.0  # km/h; higher = stronger directional bias
    p_base: float = 0.28      # base spread probability per tick per neighbor
    burn_duration: int = 5    # ticks before a burning cell becomes burnt
    tick: int = 0
    cells: List[List[int]] = field(
        default_factory=lambda: [[EMPTY] * COLS for _ in range(ROWS)]
    )
    age: List[List[int]] = field(
        default_factory=lambda: [[0] * COLS for _ in range(ROWS)]
    )
    # Cached counts — updated in step() and reset(); avoids scanning 900 cells per request
    _burning: int = field(default=0, init=False, repr=False)
    _burnt: int = field(default=0, init=False, repr=False)

    def ignite(self, row: int, col: int) -> None:
        if 0 <= row < self.rows and 0 <= col < self.cols:
            self.cells[row][col] = BURNING
            self.age[row][col] = 1

    def ignite_at(self, lat: float, lng: float, radius_cells: int = 1) -> None:
        """Ignite a small cluster centered on the given lat/lng."""
        r, c = latLng_to_cell(lat, lng)
        for dr in range(-radius_cells, radius_cells + 1):
            for dc in range(-radius_cells, radius_cells + 1):
                self.ignite(r + dr, c + dc)

    def _spread_prob(self, dr: int, dc: int) -> float:
        """
        Probability that a burning cell spreads to the neighbor at offset (dr, dc).
        Compass convention: north=0°, east=90°. Wind blows FROM wind_deg,
        so fire is most likely to spread toward wind_deg.
        """
        spread_deg = math.degrees(math.atan2(dc, -dr)) % 360
        diff = abs(spread_deg - self.wind_deg) % 360
        if diff > 180:
            diff = 360 - diff
        # Boost when spreading downwind, suppress when spreading upwind
        wind_factor = (self.wind_speed / 60.0) * math.cos(math.radians(diff))
        return min(0.92, max(0.04, self.p_base + wind_factor))

    def step(self) -> None:
        new_cells = [row[:] for row in self.cells]
        new_age   = [row[:] for row in self.age]
        for r in range(self.rows):
            for c in range(self.cols):
                if self.cells[r][c] != BURNING:
                    continue
                new_age[r][c] += 1
                if new_age[r][c] >= self.burn_duration:
                    new_cells[r][c] = BURNT
                    continue
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        if dr == 0 and dc == 0:
                            continue
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < self.rows and 0 <= nc < self.cols:
                            if self.cells[nr][nc] == EMPTY:
                                if random.random() < self._spread_prob(dr, dc):
                                    new_cells[nr][nc] = BURNING
                                    new_age[nr][nc] = 1
        self.cells = new_cells
        self.age   = new_age
        self.tick += 1
        # Recompute counts once per tick; all callers use the cached values
        burning = burnt = 0
        for row in self.cells:
            for v in row:
                if v == BURNING: burning += 1
                elif v == BURNT: burnt += 1
        self._burning = burning
        self._burnt   = burnt

    def burning_count(self) -> int:
        return self._burning

    def burnt_count(self) -> int:
        return self._burnt

    def reset(self) -> None:
        self.cells = [[EMPTY] * self.cols for _ in range(self.rows)]
        self.age   = [[0]     * self.cols for _ in range(self.rows)]
        self.tick  = 0
        self._burning = 0
        self._burnt   = 0
