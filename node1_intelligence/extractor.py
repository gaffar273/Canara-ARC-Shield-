"""
Clause segmentation + extraction for Node 1.

Splits raw circular text into clause-sized units, classifies each against the
taxonomy, and keeps the obligation-bearing ones (the chunks Node 2 diffs). Also
derives the circular-level facts the backend needs: title, issued date, the set
of regulatory sections, and a best-effort similarity to a linked prior circular.
"""

import logging
import os
import re
from typing import Dict, List, Optional

from node1_intelligence.classifier import classify, classify_domain, detect_regulator
from arc_vector import HybridVectorStore

logger = logging.getLogger("node1.extractor")

# A clause is a numbered item ("3.", "2.1", "(a)") or a sentence carrying an
# obligation. We segment on the formers' boundaries, then fall back to sentences.
_CLAUSE_MARKER = re.compile(r"(?m)^\s*(?:\d+(?:\.\d+)*[.)]|\([a-z0-9]+\)|[ivx]+\.)\s+")
_SENTENCE_SPLIT = re.compile(r"(?<=[.;])\s+(?=[A-Z(])")
_DATE_PATTERNS = [
    re.compile(r"\b(\d{4}-\d{2}-\d{2})\b"),
    re.compile(r"\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b", re.I),
    re.compile(r"\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b", re.I),
    re.compile(r"\b(\d{1,2}/\d{1,2}/\d{4})\b"),
]
_MIN_CLAUSE_LEN = 25
# Headroom for long master directions / booklets (100+ pages). Truncation past
# this is logged, never silent — a dropped clause is a dropped obligation.
_MAX_CLAUSES = int(os.getenv("NODE1_MAX_CLAUSES", "200"))


def _segments(text: str) -> List[str]:
    """Prefer numbered-clause boundaries; otherwise split into sentences."""
    if _CLAUSE_MARKER.search(text):
        parts = _CLAUSE_MARKER.split(text)
        chunks = [p.strip() for p in parts if p and p.strip()]
    else:
        chunks = []
    if not chunks:
        chunks = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]
    merged: List[str] = []
    for c in chunks:
        c = re.sub(r"\s+", " ", c)
        if len(c) < _MIN_CLAUSE_LEN and merged:
            merged[-1] = f"{merged[-1]} {c}"
        else:
            merged.append(c)
    return merged


def _clause_title(verdict: Dict, text: str) -> str:
    if verdict.get("ruleType"):
        pretty = verdict["ruleType"].replace("_", " ").title()
        return f"{verdict['domainLabel']} - {pretty}"
    head = text.split(":", 1)[0] if ":" in text[:80] else text
    return (head[:60] + "…") if len(head) > 60 else head


def _is_english_line(line: str) -> bool:
    """A usable title line: has letters and is predominantly ASCII (not a
    Devanagari letterhead or mojibake from an undecodable font)."""
    if "�" in line:  # replacement char => font had no ToUnicode map
        return False
    letters = [c for c in line if c.isalpha()]
    if not letters:
        return False
    ascii_letters = sum(1 for c in letters if c.isascii())
    return ascii_letters / len(letters) >= 0.7


def _is_hash_like(token: str) -> bool:
    """A bare hash/opaque-id token unfit to be a title (e.g. a SHA fragment or an
    upload named NT153AC48B7D5...). Long, no spaces, mostly hex/alphanumeric."""
    t = token.strip()
    if not t or " " in t:
        return False
    if len(t) >= 24 and re.fullmatch(r"[0-9A-Fa-f]+", t):
        return True
    # Long single run of alnum with a high digit ratio reads as an id, not a title.
    if len(t) >= 20 and t.isalnum():
        digits = sum(1 for c in t if c.isdigit())
        return digits / len(t) >= 0.25
    return False


def _looks_like_title(value: Optional[str]) -> bool:
    """Reject empty, mojibake, replacement-char, or hash-like candidates."""
    if not value:
        return False
    v = value.strip()
    if len(v) < 4 or "�" in v or _is_hash_like(v):
        return False
    return _is_english_line(v)


def sanitize_title(candidate: Optional[str], text: str, filename: str, regulator: str) -> str:
    """One clean, human-readable title. Tries the candidate, then a real heading
    in the body, then the filename (only if it isn't a hash), then a generic
    regulator label — never returns mojibake or an opaque id."""
    if _looks_like_title(candidate):
        return candidate.strip()[:160]
    heading = extract_title(text, filename)
    if _looks_like_title(heading):
        return heading.strip()[:160]
    stem = filename.rsplit(".", 1)[0]
    if _looks_like_title(stem):
        return stem[:160]
    reg = (regulator or "Regulatory").strip()
    return f"{reg} Circular"


def extract_title(text: str, filename: str) -> str:
    """Subject line if present, else the first substantial English line, else the filename."""
    for line in (l.strip() for l in text.splitlines()):
        m = re.match(r"^(?:sub|subject|re)\s*[:\-]\s*(.+)$", line, re.I)
        if m and len(m.group(1)) > 8 and _is_english_line(m.group(1)):
            return m.group(1).strip()[:160]
    for line in (l.strip() for l in text.splitlines()):
        if len(line) > 15 and not line.isupper() and _is_english_line(line):
            return line[:160]
    return filename.rsplit(".", 1)[0]


def extract_issued_date(text: str) -> Optional[str]:
    head = text[:1500]
    for pattern in _DATE_PATTERNS:
        m = pattern.search(head)
        if m:
            return m.group(1)
    return None


def best_similarity(text: str, candidates: List[Dict], circular_id: Optional[str] = None) -> Optional[Dict]:
    """Most similar prior circular by Hybrid Search (semantic embedding + keyword).

    Candidates are indexed in a persistent vector store; the current circular is
    queried against them. Semantic embeddings catch circulars about the same
    subject even when they share little exact wording, while the keyword half
    keeps exact regulatory terms decisive. Returns the best match above a small
    floor, or None. Falls back to keyword-only ranking if embeddings are down.
    """
    if not (text or "").strip() or not candidates:
        return None

    store = HybridVectorStore("circulars")
    for other in candidates:
        cid = other.get("circularId")
        if cid:
            store.upsert(cid, other.get("text", ""), {"title": other.get("title", "")})

    hit = store.best(text, threshold=0.10, top_k=25, exclude_id=circular_id)
    if not hit:
        return None
    return {"circularId": hit.id, "similarity": round(hit.score, 3)}


def extract_clauses(text: str) -> List[Dict]:
    """Obligation-bearing clauses, classified and capped. Each maps to a Node 2 chunk."""
    clauses: List[Dict] = []
    truncated = False
    for index, segment in enumerate(_segments(text)):
        verdict = classify(segment)
        if not verdict["obligationBearing"]:
            continue
        if len(clauses) >= _MAX_CLAUSES:
            truncated = True
            break
        clauses.append(
            {
                "id": f"CLA-{index:03d}",
                "section": verdict["regSection"],
                "title": _clause_title(verdict, segment),
                "text": segment,
                "obligationBearing": True,
                "_domain": verdict["domain"],
                "_ruleType": verdict["ruleType"],
                "_source": verdict.get("source", "keyword"),
                "_confidence": verdict["confidence"],
            }
        )
    if truncated:
        logger.warning(
            "Clause cap (%d) reached; further obligation clauses were not extracted. "
            "Consider raising NODE1_MAX_CLAUSES for very long documents.",
            _MAX_CLAUSES,
        )
    return clauses


def analyze_text(text: str, filename: str, linked: List[Dict], corpus: Optional[List[Dict]] = None,
                 circular_id: Optional[str] = None) -> Dict:
    """Full Node 1 verdict for a circular: regulator, title, date, sections, clauses."""
    clauses = extract_clauses(text)
    if not clauses:
        _, domain_def, _ = classify_domain(text)
        clauses = [
            {
                "id": "CLA-000",
                "section": domain_def["regSection"],
                "title": extract_title(text, filename),
                "text": re.sub(r"\s+", " ", text[:600]).strip(),
                "obligationBearing": False,
                "_domain": None,
                "_ruleType": None,
                "_confidence": 0.3,
            }
        ]
    sections = list(dict.fromkeys(c["section"] for c in clauses)) or ["Other"]
    candidates: List[Dict] = []
    seen_ids = set()
    for cand in [*linked, *(corpus or [])]:
        cid = cand.get("circularId")
        if cid and cid not in seen_ids:
            seen_ids.add(cid)
            candidates.append(cand)
    return {
        "regulator": detect_regulator(text),
        "title": sanitize_title(extract_title(text, filename), text, filename, detect_regulator(text)),
        "issuedDate": extract_issued_date(text),
        "sections": sections,
        "similarTo": best_similarity(text, candidates, circular_id=circular_id),
        "clauses": clauses,
    }
