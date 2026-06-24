"""
Optional LLM enrichment for Node 1.

Off by default — the taxonomy classifier is fully deterministic and offline. If
NODE1_LLM_URL is set (any OpenAI-compatible /chat/completions endpoint, e.g. a
local Ollama serving Gemma, or a hosted API with NODE1_LLM_KEY), this refines the
circular title and the per-clause titles. Any failure or timeout falls back
silently to the rule-based result, so the pipeline never blocks on the model.

For Ollama: point NODE1_LLM_URL at http://localhost:11434/v1/chat/completions and
set NODE1_LLM_MODEL=gemma3:12b. No API key needed.
"""

import json
import logging
import re
import urllib.error
import urllib.request
from typing import Dict, List, Optional

import httpx

from node1_intelligence import config

logger = logging.getLogger("node1.llm")

_SYSTEM = (
    "You are a banking regulatory analyst. You classify and summarise clauses from "
    "RBI/SEBI/IRDAI/MCA circulars. Reply with strict JSON only, no markdown."
)

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
_THINK = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)


def enabled() -> bool:
    return bool(config.llm_url())


def _balanced_objects(text: str):
    """Yield every balanced {...} substring, ignoring braces inside strings.

    A naive greedy regex breaks on reasoning models whose <think> output or
    surrounding prose contains stray braces; this walks brace depth instead and
    yields each top-level object so a decoy like "use {} here" can be skipped.
    """
    i = 0
    n = len(text)
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        depth = 0
        in_str = False
        escape = False
        for j in range(i, n):
            ch = text[j]
            if in_str:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    yield text[i : j + 1]
                    break
        i = j + 1 if depth == 0 else n


def _parse_json(content: str) -> Optional[Dict]:
    """Tolerate fences, prose, and reasoning-model <think> blocks around the JSON.

    Prefers the object carrying our expected keys, so a stray {} in prose or a
    thinking block is skipped in favour of the real {title, clauses} payload.
    """
    cleaned = _THINK.sub("", content).strip()
    cleaned = _FENCE.sub("", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    fallback: Optional[Dict] = None
    for candidate in _balanced_objects(cleaned):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        if "title" in parsed or "clauses" in parsed:
            return parsed
        if fallback is None:
            fallback = parsed
    return fallback


async def _chat(prompt: str) -> Optional[Dict]:
    headers = {"Content-Type": "application/json"}
    key = config.llm_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    user_content = f"/no_think {prompt}" if config.llm_no_think() else prompt
    body = {
        "model": config.llm_model(),
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    try:
        async with httpx.AsyncClient(timeout=config.llm_timeout()) as client:
            resp = await client.post(config.llm_url(), headers=headers, json=body)
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            return _parse_json(content)
    except Exception as exc:  # noqa: BLE001 — any failure falls back to rules
        logger.warning("LLM enrichment failed, using rule-based result: %s", exc)
        return None


async def refine(title: str, clauses: List[Dict]) -> Optional[Dict]:
    """Best-effort refinement. Returns {title, clauses:[{id,title}]} or None.

    The digest is kept small (12 clauses, 240 chars each) so the prompt fits
    inside Ollama's default 4K context window with room for the response.
    """
    if not enabled() or not config.llm_refine() or not clauses:
        return None
    digest = [{"id": c["id"], "text": c["text"][:240]} for c in clauses[:12]]
    prompt = (
        "Given this regulatory circular, return JSON with a concise human title and a "
        "one-line plain-English title for each clause.\n\n"
        f'Current title: "{title}"\n'
        f"Clauses: {json.dumps(digest)}\n\n"
        'Respond as: {"title": "...", "clauses": [{"id": "CLA-000", "title": "..."}]}'
    )
    result = await _chat(prompt)
    if not isinstance(result, dict):
        return None
    return result


def _fallback_answer(query: str, citations: List[Dict]) -> str:
    """Deterministic answer when the LLM is disabled or unavailable.

    Summarises the retrieved clauses and their verification status so the
    copilot is useful offline, mirroring the rule-based fallbacks elsewhere.
    """
    if not citations:
        return (
            "No matching clauses were found in the ingested circulars for "
            f'"{query}". Upload and process the relevant circular, then ask again.'
        )
    lines = [
        f"Found {len(citations)} relevant clause(s) for your question:",
    ]
    for c in citations:
        status = c.get("verification", "UNVERIFIED")
        lines.append(f'- {c.get("title", "Clause")} (verification: {status})')
    return "\n".join(lines)


async def answer(query: str, citations: List[Dict]) -> str:
    """Natural-language RAG answer grounded in the retrieved citations.

    Uses the LLM when enabled; on disable/timeout/failure falls back to a
    deterministic summary so the copilot endpoint never blocks the pipeline.
    """
    fallback = _fallback_answer(query, citations)
    if not enabled() or not citations:
        return fallback
    digest = [
        {"title": c.get("title", ""), "verification": c.get("verification", "UNVERIFIED")}
        for c in citations[:8]
    ]
    prompt = (
        "Answer the compliance officer's question using ONLY the retrieved clauses "
        "below. Be concise (3-5 sentences), cite clause titles, and note any clause "
        'whose verification status is FAIL or REVIEW as a compliance gap.\n\n'
        f'Question: "{query}"\n'
        f"Retrieved clauses: {json.dumps(digest)}\n\n"
        'Respond as JSON: {"answer": "..."}'
    )
    result = await _chat(prompt)
    if isinstance(result, dict) and isinstance(result.get("answer"), str):
        return result["answer"].strip() or fallback
    return fallback


def _classify_sync(prompt: str) -> Optional[Dict]:
    """Synchronous one-shot chat for the classification ladder's Tier 3.

    The classify() path is synchronous (called per-clause inside extraction), so
    this uses urllib rather than the async httpx _chat above. Any failure returns
    None so the ladder keeps the Tier 1/Tier 2 verdict.
    """
    url = config.llm_url()
    if not url:
        return None
    headers = {"Content-Type": "application/json"}
    key = config.llm_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    user_content = f"/no_think {prompt}" if config.llm_no_think() else prompt
    body = json.dumps({
        "model": config.llm_model(),
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=config.llm_timeout()) as resp:
            payload = json.loads(resp.read())
        content = payload["choices"][0]["message"]["content"]
        return _parse_json(content)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
        logger.warning("LLM classify unavailable (%s); ladder keeps rule/semantic verdict.", exc)
        return None


def classify_rule(text: str, candidates: List[Dict]) -> Optional[Dict]:
    """Tier 3 of the classification ladder: constrained LLM rule-type pick.

    `candidates` is the taxonomy's allowed (domain, ruleType) pairs. The model must
    choose one of them (or NONE) — it never invents a label, so the output stays
    inside the taxonomy and the audit trail holds. Returns {domain, ruleType,
    confidence} or None (disabled / unreachable / no confident pick).
    """
    if not enabled() or not text.strip() or not candidates:
        return None
    options = [{"domain": c["domain"], "ruleType": c["ruleType"]} for c in candidates]
    prompt = (
        "Classify the banking regulatory clause below into exactly ONE of the allowed "
        "rule types. Choose only from the provided list; if none fit, return NONE.\n\n"
        f'Clause: "{text[:500]}"\n'
        f"Allowed rule types: {json.dumps(options)}\n\n"
        'Respond as JSON: {"domain": "<key>", "ruleType": "<TYPE>", "confidence": 0.0-1.0} '
        'or {"ruleType": "NONE"}.'
    )
    result = _classify_sync(prompt)
    if not isinstance(result, dict):
        return None
    rule_type = result.get("ruleType")
    if not rule_type or rule_type == "NONE":
        return None
    allowed = {c["ruleType"] for c in candidates}
    if rule_type not in allowed:
        return None
    domain = result.get("domain")
    valid_domain = next((c["domain"] for c in candidates if c["ruleType"] == rule_type), None)
    try:
        conf = float(result.get("confidence", 0.7))
    except (TypeError, ValueError):
        conf = 0.7
    return {
        "domain": domain if domain in {c["domain"] for c in candidates} else valid_domain,
        "ruleType": rule_type,
        "confidence": round(min(0.95, max(0.5, conf)), 2),
    }


async def warmup() -> None:
    """Load the model into VRAM at startup so the first real /analyze is warm.

    Fully guarded: a missing/slow Ollama just logs and returns. Cold load of 12B
    on a 4060 takes ~70s, so this is given a long timeout independent of request
    handling. No-op when LLM enrichment is disabled.
    """
    if not enabled():
        return
    headers = {"Content-Type": "application/json"}
    key = config.llm_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    body = {
        "model": config.llm_model(),
        "messages": [{"role": "user", "content": "ok"}],
        "temperature": 0,
        "max_tokens": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            await client.post(config.llm_url(), headers=headers, json=body)
        logger.info("LLM warmup complete: %s", config.llm_model())
    except Exception as exc:  # noqa: BLE001 — warmup is best-effort
        logger.warning("LLM warmup skipped (%s); first call will be cold", exc)
