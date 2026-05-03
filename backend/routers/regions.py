from fastapi import APIRouter, HTTPException
from models import Region
import state

router = APIRouter(prefix="/regions", tags=["regions"])


@router.get("/")
def list_regions() -> list[Region]:
    return list(state.regions.values())


@router.get("/{region_id}")
def get_region(region_id: str) -> Region:
    if region_id not in state.regions:
        raise HTTPException(status_code=404, detail="Region not found")
    return state.regions[region_id]


@router.post("/", status_code=201)
def create_region(region: Region) -> Region:
    if region.id in state.regions:
        raise HTTPException(status_code=409, detail="Region ID already exists")
    state.regions[region.id] = region
    return region


@router.put("/{region_id}")
def update_region(region_id: str, region: Region) -> Region:
    if region_id not in state.regions:
        raise HTTPException(status_code=404, detail="Region not found")
    state.regions[region_id] = region
    return region


@router.delete("/{region_id}", status_code=204)
def delete_region(region_id: str) -> None:
    if region_id not in state.regions:
        raise HTTPException(status_code=404, detail="Region not found")
    del state.regions[region_id]
