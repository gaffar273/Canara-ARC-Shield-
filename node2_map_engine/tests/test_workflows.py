"""Node 2 analyzer tests: real LLM path, validation, and rule-based fallback.

No network: the LLM HTTP call is monkeypatched. These assert the engine returns
the {change_type, change_reason, impact, summary, confidence} contract on the
real path and degrades to the deterministic analyzer on any failure.
"""

import asyncio

from node2_map_engine import config
from node2_map_engine.llm import LLMEngine, RuleBasedAnalyzer, _parse_json


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_fallback_when_llm_disabled(monkeypatch):
    monkeypatch.setattr(config, "llm_enabled", lambda: False)
    engine = LLMEngine()
    result = _run(engine.evaluate_diff("", "Banks must maintain MFA on all portals.", "+ ..."))
    assert result["change_type"] == "ADDED"
    assert result["impact"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
    assert 0.0 <= result["confidence"] <= 1.0


def test_real_llm_path_maps_fields(monkeypatch):
    monkeypatch.setattr(config, "llm_enabled", lambda: True)
    monkeypatch.setattr(
        LLMEngine,
        "_llm_evaluate",
        lambda self, o, n, d: {
            "change_type": "MODIFIED",
            "change_reason": "Retention raised from 2 to 3 years.",
            "impact": "HIGH",
            "summary": "Extend call-recording retention to 3 years.",
            "confidence": 0.88,
        },
    )
    engine = LLMEngine()
    result = _run(engine.evaluate_diff("retain 2 years", "retain 3 years", "- 2 + 3"))
    assert result["change_type"] == "MODIFIED"
    assert result["impact"] == "HIGH"
    assert result["confidence"] == 0.88
    assert "retention" in result["summary"].lower()


def test_fallback_when_llm_returns_none(monkeypatch):
    monkeypatch.setattr(config, "llm_enabled", lambda: True)
    monkeypatch.setattr(LLMEngine, "_llm_evaluate", lambda self, o, n, d: None)
    engine = LLMEngine()
    result = _run(engine.evaluate_diff("retain 2 years", "retain 3 years", "- 2 + 3"))
    # Rule-based verdict: a numeric modification, never crashes.
    assert result["change_type"] == "MODIFIED"
    assert result["impact"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}


def test_validate_rejects_bad_impact():
    engine = LLMEngine()
    bad = engine._validate(
        {"change_type": "MODIFIED", "impact": "SEVERE", "summary": "x", "confidence": 0.9},
        "old", "new", "diff",
    )
    assert bad is None


def test_validate_recovers_change_type_and_clamps_confidence():
    engine = LLMEngine()
    out = engine._validate(
        {"change_type": "???", "impact": "low", "summary": "", "confidence": 5},
        "", "a brand new obligation", "+ new",
    )
    assert out["change_type"] == "ADDED"      # recovered from old/new text
    assert out["impact"] == "LOW"             # upper-cased
    assert out["confidence"] <= 0.99          # clamped
    assert out["summary"]                     # filled from deterministic phrasing


def test_change_types_match_backend_contract():
    """The engine must only emit ADDED/MODIFIED/DELETED (the MAP schema enum)."""
    rb = RuleBasedAnalyzer()
    assert rb._detect_change_type("prior text", "") == "DELETED"
    assert rb._detect_change_type("", "new text") == "ADDED"
    assert rb._detect_change_type("a", "b") == "MODIFIED"


def test_parse_json_strips_think_block():
    raw = '<think>let me reason... {decoy: 1}</think>\n{"change_type":"ADDED","impact":"LOW","summary":"s"}'
    parsed = _parse_json(raw)
    assert parsed["change_type"] == "ADDED"
    assert parsed["impact"] == "LOW"
