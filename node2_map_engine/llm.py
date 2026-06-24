"""
Node 2 change analysis.

Two analyzers behind one contract, `evaluate_diff(old, new, diff) -> dict`:

- `LLMEngine` (default when NODE2_LLM_URL is set): a banking regulatory analyst
  model (any OpenAI-compatible /chat/completions endpoint, e.g. a local Ollama
  serving deepseek-r1:8b) classifies the change, scores its impact, and writes a
  human summary. The prompt constrains the model to the allowed enums; the output
  is validated and clamped before use.
- `RuleBasedAnalyzer`: a deterministic regex/heuristic analyzer. It is the
  automatic fallback whenever the LLM is disabled, unreachable, or returns
  unusable JSON — so the pipeline never blocks on the model.

For Ollama: point NODE2_LLM_URL at http://localhost:11434/v1/chat/completions and
set NODE2_LLM_MODEL=deepseek-r1:8b. No API key needed.
"""

import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from node2_map_engine import config

logger = logging.getLogger(__name__)

_CHANGE_TYPES = {"ADDED", "MODIFIED", "DELETED"}
_IMPACTS = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}


class RuleBasedAnalyzer:
    """Deterministic regulatory change analyzer. Offline, no external calls.

    Serves as the automatic fallback for the LLM analyzer; also usable on its own
    for a fully offline deployment.
    """

    CRITICAL_KEYWORDS = [
        "must", "shall", "mandatory", "required", "compliance",
        "penalty", "fine", "suspension", "prohibited", "forbidden",
        "increased", "decreased", "enhanced", "strengthened", "weakened"
    ]

    HIGH_IMPACT_PATTERNS = [
        r"capital.*requirement.*increased",
        r"reserve.*ratio.*changed",
        r"compliance.*deadline.*moved",
        r"penalty.*increased",
        r"exposure.*limit.*reduced",
        r"kyc.*enhanced",
        r"risk.*weight.*increased"
    ]

    MEDIUM_IMPACT_PATTERNS = [
        r"reporting.*frequency.*changed",
        r"documentation.*requirement.*added",
        r"frequency.*updated",
        r"timeline.*extended"
    ]

    def __init__(self):
        logger.info("Rule-based regulatory analyzer ready (deterministic fallback)")

    def _calculate_numeric_change(self, old_text: str, new_text: str) -> tuple:
        """Extract numeric values and calculate percentage change"""
        old_numbers = re.findall(r'\d+[,\d]*\.?\d*', old_text)
        new_numbers = re.findall(r'\d+[,\d]*\.?\d*', new_text)

        if old_numbers and new_numbers:
            try:
                old_val = float(old_numbers[-1].replace(',', ''))
                new_val = float(new_numbers[-1].replace(',', ''))
                if old_val > 0:
                    pct_change = ((new_val - old_val) / old_val) * 100
                    return abs(pct_change), new_val > old_val
            except:
                pass
        return 0, None

    def _detect_change_type(self, old_text: str, new_text: str) -> str:
        """Determine if change is ADDED, MODIFIED, or DELETED"""
        if not old_text or old_text.strip() == "":
            return "ADDED"
        if not new_text or new_text.strip() == "":
            return "DELETED"
        return "MODIFIED"

    def _assess_impact(self, old_text: str, new_text: str, diff_text: str) -> str:
        """Rule-based impact assessment"""
        combined_text = (old_text + " " + new_text + " " + diff_text).lower()

        # Check critical patterns
        for pattern in self.HIGH_IMPACT_PATTERNS:
            if re.search(pattern, combined_text, re.IGNORECASE):
                pct_change, is_increase = self._calculate_numeric_change(old_text, new_text)
                if pct_change > 50:
                    return "CRITICAL"
                return "HIGH"

        # Check medium patterns
        for pattern in self.MEDIUM_IMPACT_PATTERNS:
            if re.search(pattern, combined_text, re.IGNORECASE):
                return "MEDIUM"

        # Check for numeric changes
        pct_change, _ = self._calculate_numeric_change(old_text, new_text)
        if pct_change > 30:
            return "HIGH"
        elif pct_change > 10:
            return "MEDIUM"

        # Check for mandatory keywords
        critical_count = sum(1 for kw in self.CRITICAL_KEYWORDS if kw in combined_text)
        if critical_count >= 2:
            return "HIGH"
        elif critical_count == 1:
            return "MEDIUM"

        return "LOW"

    def _generate_reason(self, old_text: str, new_text: str, change_type: str) -> str:
        """Generate human-readable change reason"""
        pct_change, is_increase = self._calculate_numeric_change(old_text, new_text)

        if change_type == "ADDED":
            return f"New regulatory obligation introduced"
        elif change_type == "DELETED":
            return f"Regulatory requirement removed or superseded"
        else:
            if pct_change > 0:
                direction = "increased" if is_increase else "decreased"
                return f"Regulatory requirement {direction} by {pct_change:.1f}%"

            # Check for key changes in wording
            if "enhanced" in new_text.lower() and "enhanced" not in old_text.lower():
                return "Regulatory requirement enhanced"
            elif "strengthened" in new_text.lower():
                return "Regulatory requirement strengthened"
            else:
                return "Regulatory requirement modified"

    def _compute_confidence(self, old_text: str, new_text: str, diff_text: str,
                            change_type: str, impact: str) -> float:
        """Confidence the rule-based verdict reflects a real, well-understood change.

        Low confidence routes a MAP to the human review queue. We are most certain
        when we can see a concrete numeric delta against a known prior clause, and
        least certain about brand-new clauses with no historical baseline or weak
        regulatory signal.
        """
        combined = (old_text + " " + new_text + " " + diff_text).lower()
        critical_hits = sum(1 for kw in self.CRITICAL_KEYWORDS if kw in combined)
        pct_change, _ = self._calculate_numeric_change(old_text, new_text)

        if change_type == "ADDED":
            # No prior clause to diff against; impact is inferred, not measured.
            score = 0.6 + min(0.1, 0.03 * critical_hits)
        elif change_type == "DELETED":
            score = 0.7
        elif pct_change > 0:
            # A measurable numeric change is the strongest signal we have.
            score = 0.9 if pct_change >= 10 else 0.82
        else:
            # Wording-only modification: lean on regulatory keyword density.
            score = 0.6 + 0.08 * critical_hits

        if impact in ("HIGH", "CRITICAL") and critical_hits >= 2:
            score += 0.05
        if impact == "LOW" and critical_hits == 0:
            score -= 0.1

        return round(max(0.4, min(0.95, score)), 2)

    async def evaluate_diff(self, old_text: str, new_text: str, diff_text: str) -> Dict[str, Any]:
        """Analyze a regulatory change deterministically (no external calls)."""
        change_type = self._detect_change_type(old_text, new_text)
        impact = self._assess_impact(old_text, new_text, diff_text)
        reason = self._generate_reason(old_text, new_text, change_type)

        if change_type == "ADDED":
            summary = f"New {impact.lower()} impact regulatory clause added"
        elif change_type == "DELETED":
            summary = f"Regulatory clause removed or superseded"
        else:
            summary = reason

        return {
            "change_type": change_type,
            "change_reason": reason,
            "impact": impact,
            "summary": summary,
            "confidence": self._compute_confidence(old_text, new_text, diff_text, change_type, impact),
        }


# ---- LLM JSON parsing (tolerates fences, prose, reasoning <think> blocks) -----

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
_THINK = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
_EXPECTED_KEYS = {"change_type", "impact", "summary"}


def _balanced_objects(text: str):
    """Yield every balanced {...} substring, ignoring braces inside strings.

    A reasoning model's <think> output or surrounding prose can contain stray
    braces; walking brace depth (rather than a greedy regex) lets a decoy like
    "use {} here" be skipped in favour of the real payload.
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
                    yield text[i:j + 1]
                    break
        i = j + 1 if depth == 0 else n


def _parse_json(content: str) -> Optional[Dict]:
    """Prefer the object carrying our expected keys, skipping prose / <think>."""
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
        if _EXPECTED_KEYS & parsed.keys():
            return parsed
        if fallback is None:
            fallback = parsed
    return fallback


_SYSTEM = (
    "You are a banking regulatory analyst. You compare an OLD regulatory clause "
    "with a NEW one and report how the obligation changed. Reply with strict JSON "
    "only, no markdown."
)


class LLMEngine:
    """LLM-backed change analysis with an automatic rule-based fallback.

    `evaluate_diff` returns the same contract as `RuleBasedAnalyzer`:
    {change_type, change_reason, impact, summary, confidence}. When the LLM is
    disabled or fails, the rule-based analyzer's verdict is returned instead, so
    callers never have to handle a missing model.
    """

    def __init__(self):
        self._fallback = RuleBasedAnalyzer()
        if config.llm_enabled():
            logger.info("MAP analyzer: LLM engine (%s)", config.llm_model())
        else:
            logger.info("MAP analyzer: rule-based engine (LLM disabled)")

    async def evaluate_diff(self, old_text: str, new_text: str, diff_text: str) -> Dict[str, Any]:
        if not config.llm_enabled():
            return await self._fallback.evaluate_diff(old_text, new_text, diff_text)

        verdict = self._llm_evaluate(old_text, new_text, diff_text)
        if verdict is None:
            logger.warning("LLM analysis unusable; falling back to rule-based verdict.")
            return await self._fallback.evaluate_diff(old_text, new_text, diff_text)
        return verdict

    def _prompt(self, old_text: str, new_text: str, diff_text: str) -> str:
        old_block = old_text.strip() or "(no prior clause — this obligation is new)"
        return (
            "Compare the OLD and NEW banking regulatory clause and classify the change.\n\n"
            f"OLD CLAUSE:\n\"{old_block[:1500]}\"\n\n"
            f"NEW CLAUSE:\n\"{new_text.strip()[:1500]}\"\n\n"
            f"WORD DIFF (context):\n{diff_text[:1500]}\n\n"
            "Respond as JSON with exactly these fields:\n"
            '{\n'
            '  "change_type": "ADDED" | "MODIFIED" | "DELETED",\n'
            '  "impact": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",\n'
            '  "change_reason": "<one concise sentence on what changed and why it matters>",\n'
            '  "summary": "<one concise sentence a compliance officer can act on>",\n'
            '  "confidence": <number between 0 and 1>\n'
            "}\n"
            "ADDED = no prior obligation existed. DELETED = the obligation was withdrawn. "
            "MODIFIED = an existing obligation changed. Judge impact by how much operational, "
            "financial, or legal exposure the change creates."
        )

    def _llm_evaluate(self, old_text: str, new_text: str, diff_text: str) -> Optional[Dict[str, Any]]:
        url = config.llm_url()
        if not url:
            return None
        headers = {"Content-Type": "application/json"}
        key = config.llm_key()
        if key:
            headers["Authorization"] = f"Bearer {key}"
        prompt = self._prompt(old_text, new_text, diff_text)
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
            parsed = _parse_json(content)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
            logger.warning("LLM analysis unavailable (%s).", exc)
            return None
        return self._validate(parsed, old_text, new_text, diff_text)

    def _validate(
        self, parsed: Optional[Dict], old_text: str, new_text: str, diff_text: str
    ) -> Optional[Dict[str, Any]]:
        """Coerce the model output into the contract; reject if core fields are bad.

        change_type/impact must be in the allowed enums (a wrong change_type is
        recoverable from the presence of old/new text, but a missing one is not).
        Confidence is clamped; free-text fields fall back to deterministic phrasing.
        """
        if not isinstance(parsed, dict):
            return None

        change_type = str(parsed.get("change_type", "")).strip().upper()
        if change_type not in _CHANGE_TYPES:
            change_type = self._fallback._detect_change_type(old_text, new_text)

        impact = str(parsed.get("impact", "")).strip().upper()
        if impact not in _IMPACTS:
            return None

        try:
            confidence = float(parsed.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = round(min(0.99, max(0.4, confidence)), 2)

        summary = str(parsed.get("summary", "")).strip()
        reason = str(parsed.get("change_reason", "")).strip()
        if not summary:
            summary = self._fallback._generate_reason(old_text, new_text, change_type)
        if not reason:
            reason = summary

        return {
            "change_type": change_type,
            "change_reason": reason[:500],
            "impact": impact,
            "summary": summary[:500],
            "confidence": confidence,
        }
