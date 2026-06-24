"""
HTTP wrapper for the Node 2 MAP Engine.

The ARC Shield backend (Node/TS) reaches every agent over HTTP. This server
exposes `POST /map`, accepts the backend's batch request, runs each clause
through `run_map_engine`, and translates the engine's diff-style MAP into the
backend's `ComplianceMap` contract (field names + role/category derivation).

Run:  uvicorn node2_map_engine.api:app --port 8002
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

from node2_map_engine.schemas import IncomingChunk
from node2_map_engine.workflow import run_map_engine

logger = logging.getLogger("node2.api")

app = FastAPI(title="Node 2 — MAP Engine", version="1.0.0")


# ---- Request contract (mirrors backend adapters/node2MapEngine.ts) ----------

class ClauseIn(BaseModel):
    id: str
    section: str
    title: str
    text: str
    obligationBearing: bool = True


class BaselineClauseIn(BaseModel):
    """A clause from a circular this one explicitly cites. Supplied by the
    backend from the resolved reference graph as the authoritative prior version
    to diff against, ahead of the engine's own semantic history store."""
    section: str
    title: str
    text: str
    sourceCircularId: str


class MapRequest(BaseModel):
    circularId: str
    regulator: Optional[str] = None
    circularDate: Optional[str] = None
    clauses: List[ClauseIn]
    baseline: List[BaselineClauseIn] = []


# ---- Response contract (mirrors backend types/domain.ts ComplianceMap) ------

class ComplianceMapOut(BaseModel):
    id: str
    circularId: str
    clauseId: str
    changeType: str
    changeReason: str
    impact: str
    summary: str
    oldObligation: Optional[str] = None
    newObligation: str
    department: str
    owner: str
    deadline: Optional[str] = None
    category: str
    confidence: float
    needsReview: bool


# ---- Translation tables -----------------------------------------------------

# Node 2 routes to free-text departments; the backend's RBAC knows four roles.
_DEPARTMENT_TO_ROLE = {
    "Compliance": "compliance",
    "Data Privacy Office": "compliance",
    "General Legal": "compliance",
    "Information Security": "it",
    "Treasury": "cxo",
    "Risk Management": "cxo",
}

# Cyber/IT obligations are technical controls; the rest are policy obligations.
_TECHNICAL_SECTIONS = {"cyber", "it risk", "information security", "infosec"}

# Content signals that override the section-based default. A treasury threshold
# change is a system/config change (Cat A) even though its section is "policy";
# an InfoSec SOP rewrite is a document change (Cat B) despite a technical section.
_TECHNICAL_SIGNALS = {
    "password", "threshold", "limit", "configuration", "config", "parameter",
    "mfa", "encryption", "api", "database", "system", "ratio", "value",
}
_POLICY_SIGNALS = {
    "sop", "policy", "governance", "documentation", "procedure", "board",
    "framework", "disclosure",
}


def _role_for(department: str) -> str:
    return _DEPARTMENT_TO_ROLE.get(department, "compliance")


def _category_for(section: str, text: str = "") -> str:
    """Technical (Cat A, system/config change) vs Policy (Cat B, document change).

    Content wins when it gives a clear signal; otherwise we fall back to the
    section the clause was classified under.
    """
    hay = text.lower()
    tech = sum(1 for kw in _TECHNICAL_SIGNALS if kw in hay)
    policy = sum(1 for kw in _POLICY_SIGNALS if kw in hay)
    if tech != policy:
        return "technical" if tech > policy else "policy"
    return "technical" if section.strip().lower() in _TECHNICAL_SECTIONS else "policy"


def _deadline_iso(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _to_compliance_map(final_map: dict, needs_review: bool, section: str, clause_id: str) -> ComplianceMapOut:
    department = final_map["affected_department"]
    return ComplianceMapOut(
        id=final_map["map_id"],
        circularId=final_map["source_circular"],
        clauseId=clause_id,
        changeType=final_map["change_type"],
        changeReason=final_map["change_reason"],
        impact=final_map["impact"],
        summary=final_map["summary"],
        oldObligation=final_map.get("old_obligation"),
        newObligation=final_map["new_obligation"],
        department=department,
        owner=_role_for(department),
        deadline=_deadline_iso(final_map.get("deadline")),
        category=_category_for(section, final_map.get("new_obligation", "")),
        confidence=float(final_map["confidence"]),
        needsReview=needs_review,
    )


@app.get("/health")
async def health():
    return {"ok": True, "service": "node2-map-engine"}


@app.post("/map", response_model=List[ComplianceMapOut])
async def generate_maps(req: MapRequest) -> List[ComplianceMapOut]:
    """One MAP per clause that represents an actual regulatory change.

    Clauses whose normalized text matches the stored historical clause (no
    change) produce no MAP and are silently dropped, as does any clause the
    engine fails on — a single bad clause never sinks the batch.
    """
    maps: List[ComplianceMapOut] = []

    baseline = [
        {
            "domain": b.section,
            "section_title": b.title,
            "raw_text": b.text,
            "clause_id": f"{b.sourceCircularId}::cited",
            "circular_id": b.sourceCircularId,
        }
        for b in req.baseline
    ]

    for index, clause in enumerate(req.clauses):
        chunk = IncomingChunk(
            circular_id=req.circularId,
            circular_date=req.circularDate or "",
            regulator=req.regulator or "UNKNOWN",
            domain=clause.section,
            section_title=clause.title,
            chunk_text=clause.text,
            chunk_index=index,
            chunk_hash=clause.id,
        )

        state = await run_map_engine(chunk, baseline=baseline)

        if state.get("errors"):
            logger.warning("Clause %s failed: %s", clause.id, state["errors"])
            continue
        if state.get("hash_match") or not state.get("final_map"):
            continue

        maps.append(
            _to_compliance_map(
                state["final_map"],
                bool(state.get("requires_human_review")),
                clause.section,
                clause.id,
            )
        )

    return maps
