"""
Wildfire Drone Coordination Backend
------------------------------------
Fully local. No external APIs, no databases, no cloud services.
All state lives in memory (state.py) for the lifetime of this process.

Run:
    uvicorn main:app --reload --port 8000

Docs (auto-generated):
    http://localhost:8000/docs
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import state
from models import MeshStatus
from routers import drones, missions, regions, events, fires, optimizer


@asynccontextmanager
async def lifespan(app: FastAPI):
    state.seed()
    yield


app = FastAPI(
    title="Wildfire Drone Coordination API",
    description="Local-only backend for NASA wildfire UAS coordination.",
    version="0.1.0",
    lifespan=lifespan,
)

# Allow the Next.js frontend running on localhost:3000
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(drones.router)
app.include_router(missions.router)
app.include_router(regions.router)
app.include_router(events.router)
app.include_router(fires.router)
app.include_router(optimizer.router)


@app.get("/", tags=["meta"])
def root():
    return {
        "status": "ok",
        "service": "wildfire-drone-backend",
        "note": "fully local — no external network calls",
        "docs": "/docs",
    }


@app.get("/health", tags=["meta"])
def health():
    return {
        "status": "ok",
        "drones": len(state.drones),
        "missions": len(state.missions),
        "fireZones": len(state.fire_zones),
        "regions": len(state.regions),
        "events": len(state.events),
    }


@app.get("/mesh", tags=["mesh"])
def get_mesh() -> MeshStatus:
    return state.mesh


@app.put("/mesh", tags=["mesh"])
def update_mesh(mesh_status: MeshStatus) -> MeshStatus:
    state.mesh = mesh_status
    return state.mesh
