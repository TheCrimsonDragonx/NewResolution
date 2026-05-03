from fastapi import APIRouter, Depends
from datetime import datetime
import uuid
from models import Event, Operator
from deps import get_operator
import filters
import state

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/")
def list_events(limit: int = 20, op: Operator = Depends(get_operator)) -> list[dict]:
    return filters.filter_events(state.events[-limit:], op)


@router.post("/", status_code=201)
def create_event(event: Event) -> Event:
    if not event.id:
        event = event.model_copy(update={"id": str(uuid.uuid4())})
    if not event.ts:
        event = event.model_copy(update={"ts": datetime.now().strftime("%H:%M")})
    state.events.append(event)
    return event
