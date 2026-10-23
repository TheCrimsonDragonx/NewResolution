# Resolution
### UAS Traffic Management for Wildfire ICS Operations
**VandyHacks Drydock 2026 — NASA TX 16.3: Nontraditional Aviation Operations for Wildfire Response**

---

## What This Is

Resolution is a portable, offline-capable Common Operating Picture (COP) for wildfire UAS coordination. It directly implements the architecture NASA's own ACERO research identified as the missing layer between UTM (UAS Traffic Management) and wildland fire operations.

The system addresses NASA's TX 16.3 SBIR solicitation: coordinating multiple unmanned aircraft within an active wildfire Incident Command System (ICS), in remote terrain, without reliable communications, using real satellite fire data.

**Core capabilities:**
- **QUBO-based deconfliction** — drone-to-fire-zone assignments solved as a Quadratic Unconstrained Binary Optimization problem using the Stollenwerk quantum trajectory deconfliction formulation, executed via D-Wave's Simulated Annealing sampler (hardware-agnostic; maps to a real D-Wave quantum annealer without code changes)
- **4D operational volume management** — authorized airspace blocks defined by lat/lng bounds, altitude floor/ceiling, and time window — matching NASA's PAMS volume model exactly
- **ICS role-based access** — Commander, ATGS, Pilot, and Dispatch each see only the data their ICS role requires; role filtering enforced server-side
- **Degraded-comms resilience** — three-node mesh simulation (radio / pingStation / network) with probabilistic degradation, auto-recovery, and optimizer replanning under degraded state
- **Live fire simulation** — 30×30 cellular automaton seeded from real NASA FIRMS VIIRS SNPP NRT satellite hotspot coordinates, with wind-biased spread
- **Fully offline** — no cloud dependency for core operations; fire data pre-cached from a real FIRMS API call; deployable to a fire camp on a single laptop

---

## Note on the QUBO Algorithm

**The core QUBO deconfliction algorithm (`optimizer_stub.py`) is intentionally omitted from this repository.**

During the hackathon we identified a vulnerability in VanderBot that allowed teams to access the VanderBot accounts of other participants. Out of caution we did not commit the algorithm to GitHub to prevent any team from accessing our core IP through that vector.

**If you are a judge or NASA reviewer and would like to inspect the algorithm directly, please ask us — we will provide it immediately.** The optimizer endpoint, benchmark, and all integration code surrounding it are fully present in this repository; only the QUBO solver implementation itself is withheld.

---

## Repository Structure

```
resolution/
├── backend/                         # FastAPI server — all core logic
│   ├── main.py                      # App entry point, background simulation loop
│   ├── models.py                    # Pydantic data models (Drone, Mission, FireZone, Operator, etc.)
│   ├── state.py                     # In-memory state store and seed data
│   ├── fire_sim.py                  # Cellular automaton fire spread engine (30×30 grid, Moore neighborhood)
│   ├── nasa_firms.py                # NASA FIRMS VIIRS SNPP NRT integration and cached hotspot loader
│   ├── optimizer_stub.py            # QUBO deconfliction engine — see note above
│   ├── filters.py                   # Role-based data filtering (pilot vs. commander vs. ATGS vs. dispatch)
│   ├── deps.py                      # FastAPI dependency injection (operator resolution from headers)
│   ├── data/
│   │   └── firms_cache.json         # Pre-cached real FIRMS satellite hotspot data (Salinas, CA)
│   └── routers/
│       ├── drones.py                # GET/PATCH drone state and positions
│       ├── missions.py              # Mission lifecycle: requests → approval → active 4D volumes
│       ├── regions.py               # Priority region management (critical / high / normal)
│       ├── fires.py                 # Fire zone CRUD and sync with CA grid state
│       ├── events.py                # Event log (optimizer runs, mesh events, sim resets)
│       ├── optimizer.py             # QUBO run endpoint and fleet-size benchmark sweep
│       └── operators.py             # Operator registry and role lookup
│
└── frontend/                        # Next.js dashboard
    └── app/
        └── dashboard/
            ├── page.js              # Main dashboard — polling, state management, all panels
            ├── MapView.js           # Leaflet map — fire CA grid, 4D volume rectangles, drone markers
            ├── OperatorSelector.js  # Role login screen
            └── map.css              # Map overlay styles
```

---

## How It Works

### Background Simulation Loop (`main.py`)
Runs every 4 seconds automatically after startup. Each tick: advances the fire CA grid one step, moves assigned drones toward their target fire zones (or orbits them above it), drains/recharges batteries, probabilistically degrades and auto-recovers mesh nodes, and reruns the QUBO optimizer every 10 ticks (~40 seconds).

### Fire Simulation (`fire_sim.py`)
A 30×30 cellular automaton over a ~3.3 km² bounding box centered on the Salinas, CA foothills. Each cell is empty / burning / burnt. Spread probability uses a Moore neighborhood (8 neighbors) weighted by a wind vector. Grid is seeded from real NASA FIRMS VIIRS SNPP NRT hotspot coordinates on startup.

### QUBO Deconfliction (`optimizer_stub.py` + `routers/optimizer.py`)
Implements the Stollenwerk quantum trajectory deconfliction formulation. Drone-to-fire-zone assignment is posed as a QUBO matrix where penalty terms encode spatial conflicts (two drones assigned to the same zone), priority weights (critical zones get higher weight), and assignment enforcement (every active drone gets exactly one assignment). Solved with D-Wave's `SimulatedAnnealingSampler` using 500 reads. The benchmark endpoint sweeps fleet sizes n=5 through n=30 and compares QUBO against a greedy baseline, demonstrating conflict elimination at scale.

### Role-Based Filtering (`filters.py`)
Server-side enforcement: Pilots receive full data on their own drone and own region only; other drones are returned as `{id, name, status}` with no position or payload. Mission requests are filtered to the requesting pilot. Events are filtered to mentions of the pilot's drone or region. Commanders and ATGS receive unfiltered data.

### 4D Mission Volumes (`routers/missions.py` + `MapView.js`)
Missions carry a `volume` field with `width`, `height` (in nautical miles), `minAlt`, `maxAlt` (in feet), and a time window. The frontend renders these as map rectangles with status-coded colors (purple = active, blue dashed = standby, orange = non-conforming). Volume geometry is projected from the mission's lat/lng center using a flat-earth approximation.

### Mesh Degradation (`main.py`)
Three independent comms nodes — `radio`, `pingStation`, `network` — each with `ok / warning / offline` states. Every ~60 seconds, one node degrades probabilistically (65% warning, 35% offline). Auto-recovery fires after ~32 seconds. Manual injection via `PUT /mesh` at `/docs`. Any optimizer run that executes while a node is degraded is tagged `REPLANNED UNDER DEGRADED COMMS` in the event log.

### NASA FIRMS Integration (`nasa_firms.py`)
Loads pre-cached VIIRS SNPP NRT hotspot data from `data/firms_cache.json` (9 real points, acq_date 2025-10-14, satellite N, confidence h, Salinas CA). Set `FIRMS_MAP_KEY` environment variable to pull live data instead of the cache.

---

## Running Locally

**Backend**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# API docs: http://localhost:8000/docs
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
# Dashboard: http://localhost:3000/dashboard
```

> Go to `/dashboard` directly — `localhost:3000` is a placeholder page.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, Pydantic v2, uvicorn |
| Optimizer | D-Wave `dwave-samplers` (SimulatedAnnealingSampler), `dimod` |
| Fire model | NumPy cellular automaton |
| Frontend | Next.js 14, React, Tailwind CSS |
| Map | Leaflet.js, react-leaflet, ESRI World Imagery tiles |
| Fire data | NASA FIRMS VIIRS SNPP NRT (pre-cached + live key support) |

---

## NASA Research Basis

Resolution implements concepts from:
- **NASA ACERO** — Autonomous Cooperative Entry for Remote Operations; identified role-based UTM filtering and offline-capable WFSS architecture as critical gaps
- **NASA PAMS** — Portable Airspace Management System; field-tested Spring 2025; Resolution mirrors its 4D volume model and approval workflow
- **Stollenwerk et al.** — Quantum trajectory deconfliction QUBO formulation, adapted for wildfire fleet assignment
- **NASA FIRMS VIIRS SNPP NRT** — Real satellite thermal anomaly data used to seed and drive the fire simulation

---

*Team Resolution — VandyHacks Drydock 2025*
