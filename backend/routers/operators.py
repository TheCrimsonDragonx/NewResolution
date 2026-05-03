from fastapi import APIRouter, HTTPException
import state

router = APIRouter(prefix="/operators", tags=["operators"])


@router.get("/")
def list_operators() -> list[dict]:
    return [
        {"id": op.id, "name": op.name, "role": op.role}
        for op in state.operators.values()
    ]


@router.get("/{operator_id}")
def get_operator(operator_id: str) -> dict:
    if operator_id not in state.operators:
        raise HTTPException(status_code=404, detail="Operator not found")
    op = state.operators[operator_id]
    return {"id": op.id, "name": op.name, "role": op.role}
