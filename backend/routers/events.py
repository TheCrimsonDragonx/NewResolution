from fastapi import APIRouter
from datetime import datetime
import uuid
from models import Event
import state

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/")
def list_events(limit: int = 20) -> list[Event]:
    return state.events[-limit:]


@router.post("/", status_code=201)
def create_event(event: Event) -> Event:
    if not event.id:
        event = event.model_copy(update={"id": str(uuid.uuid4())})
    if not event.ts:
        event = event.model_copy(update={"ts": datetime.now().strftime("%H:%M")})
    state.events.append(event)
    return event
