from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
import state
from models import Operator

_api_key_header = APIKeyHeader(name="X-Operator-ID", auto_error=False)


def get_operator(x_operator_id: str = Security(_api_key_header)) -> Operator:
    if x_operator_id is None:
        raise HTTPException(status_code=401, detail="X-Operator-ID header required")
    op = state.operators.get(x_operator_id)
    if op is None:
        raise HTTPException(status_code=403, detail=f"Unknown operator: {x_operator_id}")
    return op
