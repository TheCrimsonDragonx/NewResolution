from fastapi import APIRouter, HTTPException, Depends
from models import Operator, OperatorRole
from deps import get_operator
import state

router = APIRouter(prefix="/operators", tags=["operators"])


@router.get("/")
def list_operators() -> list[dict]:
    return [{"id": o.id, "name": o.name, "role": o.role} for o in state.operators.values()]


@router.get("/{operator_id}")
def get_operator_by_id(operator_id: str, op: Operator = Depends(get_operator)) -> dict:
    if op.role != OperatorRole.commander and op.id != operator_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if operator_id not in state.operators:
        raise HTTPException(status_code=404, detail="Operator not found")
    o = state.operators[operator_id]
    return {"id": o.id, "name": o.name, "role": o.role}
