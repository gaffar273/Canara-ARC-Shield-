"""
HTTP wrapper for the Node 1 Regulatory Intelligence engine.

The ARC Shield backend reaches every agent over HTTP. This exposes
`POST /analyze`, accepts the backend's `{ circularId, filename, text, context? }`
request, classifies the circular against the banking taxonomy, extracts
obligation clauses, and returns one IntelligenceResult shaped to
backend/src/types/domain.ts. No clause field leaks the engine's internals.

Run:  uvicorn node1_intelligence.api:app --port 8001
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

from node1_intelligence import llm
from node1_intelligence.extractor import analyze_text, sanitize_title

logger = logging.getLogger("node1.api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm the LLM in the background so Node 1 accepts requests immediately. The
    # model is only needed for the copilot path; classification + clause
    # extraction are LLM-free, so startup must not block on a ~70s cold load.
    task = asyncio.create_task(llm.warmup())
    yield
    task.cancel()


app = FastAPI(title="Node 1 — Regulatory Intelligence", version="1.0.0", lifespan=lifespan)


# ---- Request contract (mirrors backend adapters/node1Intelligence.ts) -------

class LinkedCircularIn(BaseModel):
    circularId: str
    refNumber: Optional[str] = None
    title: str = ""
    text: str = ""


class AnalyzeContext(BaseModel):
    linkedCirculars: List[LinkedCircularIn] = []
    corpus: List[LinkedCircularIn] = []


class AnalyzeRequest(BaseModel):
    circularId: str
    filename: str = ""
    text: str
    context: Optional[AnalyzeContext] = None


# ---- Response contract (mirrors backend types/domain.ts) --------------------

class ClauseOut(BaseModel):
    id: str
    section: str
    title: str
    text: str
    obligationBearing: bool


class SimilarOut(BaseModel):
    circularId: str
    similarity: float


class IntelligenceResultOut(BaseModel):
    circularId: str
    title: str
    regulator: str
    issuedDate: Optional[str] = None
    sections: List[str]
    similarTo: Optional[SimilarOut] = None
    clauses: List[ClauseOut]


def _to_clause_out(clause: dict) -> ClauseOut:
    return ClauseOut(
        id=clause["id"],
        section=clause["section"],
        title=clause["title"],
        text=clause["text"],
        obligationBearing=clause["obligationBearing"],
    )


class CitationIn(BaseModel):
    circularId: str = ""
    clauseId: str = ""
    title: str = ""
    verification: str = "UNVERIFIED"


class CopilotRequest(BaseModel):
    query: str
    citations: List[CitationIn] = []


class CopilotResponse(BaseModel):
    answer: str


@app.get("/health")
async def health():
    return {"ok": True, "service": "node1-regulatory-intelligence"}


@app.post("/copilot", response_model=CopilotResponse)
async def copilot(req: CopilotRequest) -> CopilotResponse:
    citations = [c.model_dump() for c in req.citations]
    text = await llm.answer(req.query, citations)
    return CopilotResponse(answer=text)


@app.post("/analyze", response_model=IntelligenceResultOut)
async def analyze(req: AnalyzeRequest) -> IntelligenceResultOut:
    linked = [lc.model_dump() for lc in (req.context.linkedCirculars if req.context else [])]
    corpus = [lc.model_dump() for lc in (req.context.corpus if req.context else [])]
    verdict = analyze_text(req.text, req.filename, linked, corpus, circular_id=req.circularId)

    title = verdict["title"]
    clauses = verdict["clauses"]

    refined = await llm.refine(title, clauses)
    if refined:
        candidate = refined.get("title")
        if candidate:
            title = sanitize_title(candidate, req.text, req.filename, verdict["regulator"])
        overrides = {c["id"]: c.get("title") for c in refined.get("clauses", []) if c.get("id")}
        for clause in clauses:
            if overrides.get(clause["id"]):
                clause["title"] = overrides[clause["id"]]

    similar = verdict["similarTo"]
    return IntelligenceResultOut(
        circularId=req.circularId,
        title=title,
        regulator=verdict["regulator"],
        issuedDate=verdict["issuedDate"],
        sections=verdict["sections"],
        similarTo=SimilarOut(**similar) if similar else None,
        clauses=[_to_clause_out(c) for c in clauses],
    )
