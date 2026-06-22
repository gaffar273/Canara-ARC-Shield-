"""
HTTP wrapper for the Node 3 Verification Engine.

The ARC Shield backend reaches every agent over HTTP. This exposes
`POST /verify`, accepts the backend's `{ circularId, maps[] }` request, runs each
MAP through the rule-based VerificationEngine, and returns a bare array of
VerificationResult objects matching backend/src/types/domain.ts.

Run:  uvicorn node3_verification_engine.api:app --port 8003
"""

import logging
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

from node3_verification_engine.engine import VerificationEngine

logger = logging.getLogger("node3.api")

app = FastAPI(title="Node 3 — Verification Engine", version="1.0.0")
_engine = VerificationEngine()


# ---- Request contract (mirrors backend adapters/node3Verification.ts) -------

class ComplianceMapIn(BaseModel):
    id: str
    circularId: str
    clauseId: str
    changeType: Optional[str] = None
    changeReason: Optional[str] = None
    impact: Optional[str] = None
    summary: Optional[str] = None
    oldObligation: Optional[str] = None
    newObligation: str = ""
    department: Optional[str] = None
    owner: Optional[str] = None
    deadline: Optional[str] = None
    category: Optional[str] = None
    confidence: float = 0.0
    needsReview: bool = False


class VerifyRequest(BaseModel):
    circularId: str
    maps: List[ComplianceMapIn]


# ---- Response contract (mirrors backend types/domain.ts) --------------------

class Evidence(BaseModel):
    kind: str
    ref: str
    timestamp: str


class VerificationResultOut(BaseModel):
    id: str
    mapId: str
    status: str
    score: float
    evidence: List[Evidence]


@app.get("/health")
async def health():
    return {"ok": True, "service": "node3-verification-engine"}


@app.post("/verify", response_model=List[VerificationResultOut])
async def verify(req: VerifyRequest) -> List[VerificationResultOut]:
    now_iso = datetime.utcnow().isoformat() + "Z"
    results: List[VerificationResultOut] = []

    for m in req.maps:
        verdict = _engine.verify_map(m.model_dump(), now_iso)
        results.append(VerificationResultOut(id=str(uuid.uuid4()), **verdict))

    return results
