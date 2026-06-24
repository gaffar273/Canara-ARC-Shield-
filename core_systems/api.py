"""
Core Systems API — stands in for Canara Bank's department/core-banking systems.

This is the GROUND TRUTH the Autonomous Validation Agent (Node 3) queries. It
exposes the *actual operational state* of each department's systems — raw facts
only (retention years, MFA flags, capital ratios), NEVER a compliance verdict.

The whole point (idea doc §3): Node 3 connects here over an API and reads the
live configuration to programmatically verify compliance — replacing manual
status check-boxes. Node 3 decides PASS/FAIL by comparing a MAP's required value
against what this service reports; this service never judges.

In production this is replaced by real connectors to core banking DBs, IAM, SIEM
and GRC platforms. The shape of the response is what matters.

Run:  uvicorn core_systems.api:app --port 8004
"""

import json
import logging
import os
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("core_systems.api")

_STATE_PATH = os.path.join(os.path.dirname(__file__), "systems_state.json")

app = FastAPI(title="Core Systems API — Department Operational State", version="1.0.0")


def _load_state() -> Dict:
    with open(_STATE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)["systems"]


def _save_state(systems: Dict) -> None:
    """Atomic write: temp file + rename, so a crash never leaves a partial file."""
    tmp = f"{_STATE_PATH}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"systems": systems}, f, indent=2)
    os.replace(tmp, _STATE_PATH)


def _coerce_like(new_value: Any, existing: Any) -> Any:
    """Coerce an incoming value to the existing value's type so Node 3's numeric
    and boolean comparisons keep working when the UI sends a string."""
    if isinstance(existing, bool):
        if isinstance(new_value, bool):
            return new_value
        return str(new_value).strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(existing, int) and not isinstance(existing, bool):
        try:
            return int(float(new_value))
        except (TypeError, ValueError):
            return new_value
    if isinstance(existing, float):
        try:
            return float(new_value)
        except (TypeError, ValueError):
            return new_value
    return new_value


class SystemState(BaseModel):
    department: str
    system: str
    parameters: Dict


@app.get("/health")
async def health():
    state = _load_state()
    return {"ok": True, "service": "core-systems-api", "departments": list(state.keys())}


@app.get("/systems")
async def all_systems():
    """Every department's live system state. Raw facts, no verdicts."""
    return _load_state()


@app.get("/systems/{department}", response_model=SystemState)
async def system_state(department: str) -> SystemState:
    """One department's live operational state, queried by the validation agent."""
    state = _load_state()
    entry = state.get(department)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No system registered for department '{department}'")
    return SystemState(department=department, system=entry["system"], parameters=entry["parameters"])


class ParamQuery(BaseModel):
    department: str
    parameter: str


@app.get("/systems/{department}/{parameter}")
async def parameter_value(department: str, parameter: str):
    """The actual value of one configuration parameter — the atomic check the
    validation agent makes against a MAP's required value."""
    state = _load_state()
    entry = state.get(department)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No system for department '{department}'")
    params = entry["parameters"]
    if parameter not in params:
        raise HTTPException(status_code=404, detail=f"No parameter '{parameter}' in {department}")
    return {
        "department": department,
        "system": entry["system"],
        "parameter": parameter,
        "actualValue": params[parameter],
    }


class ParamUpdate(BaseModel):
    value: Any


@app.put("/systems/{department}/{parameter}")
async def set_parameter(department: str, parameter: str, body: ParamUpdate):
    """Update one parameter's live value. This is how an operator changes the
    bank's operational state so the validation agent re-evaluates against it
    (e.g. lower retention below the mandate and watch a check flip PASS->FAIL).
    The incoming value is coerced to the existing value's type."""
    state = _load_state()
    entry = state.get(department)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No system for department '{department}'")
    params = entry["parameters"]
    if parameter not in params:
        raise HTTPException(status_code=404, detail=f"No parameter '{parameter}' in {department}")
    params[parameter] = _coerce_like(body.value, params[parameter])
    _save_state(state)
    logger.info("Updated %s.%s = %s", department, parameter, params[parameter])
    return {
        "department": department,
        "system": entry["system"],
        "parameter": parameter,
        "actualValue": params[parameter],
    }
