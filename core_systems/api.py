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
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("core_systems.api")

_STATE_PATH = os.path.join(os.path.dirname(__file__), "systems_state.json")

app = FastAPI(title="Core Systems API — Department Operational State", version="1.0.0")


def _load_state() -> Dict:
    with open(_STATE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)["systems"]


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
