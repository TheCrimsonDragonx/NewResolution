from fastapi import Header, HTTPException
from typing import Optional
import state
from models import Operator


def get_operator(x_operator_id: Optional[str] = Header(default=None)) -> Operator:
    if x_operator_id is None:
        raise HTTPException(status_code=401, detail="X-Operator-ID header required")
    op = state.operators.get(x_operator_id)
    if op is None:
        raise HTTPException(status_code=403, detail=f"Unknown operator: {x_operator_id}")
    return op
