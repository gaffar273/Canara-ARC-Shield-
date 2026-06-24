"""
Node 3 — Autonomous Validation Agent (programmatic, deterministic).

This is the agent the idea doc describes: it connects over an API to the bank's
core/department systems (the Core Systems API, core_systems/api.py) and
*programmatically verifies* compliance — replacing manual status check-boxes. It
does NOT read a stored verdict; it reads the actual operational value and
computes the verdict by comparison.

For each MAP:
  1. Match it to a check in checks_catalog.json (what to verify + how).
  2. Query the owning department's live system for the ACTUAL parameter value.
  3. Compare actual vs the regulator's required value using the check operator.
       satisfied            -> PASS    (Indicator = 1; bank already compliant)
       not satisfied        -> FAIL    (Indicator = 0; real gap, with the numbers)
  4. No matching check, or the system can't answer -> REVIEW (human decides).

Two agents share this core: a Technical Compliance Agent validates Category A
(system/config) MAPs, a Policy Compliance Agent validates Category B (policy/
document) MAPs; the verdict records which agent produced it. Deterministic by
design: the same MAP + same system state always yields the same verdict, so the
audit trail holds. No LLM.
"""

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("node3.engine")

_CATALOG_PATH = os.path.join(os.path.dirname(__file__), "checks_catalog.json")
_SYSTEMS_URL = os.getenv("CORE_SYSTEMS_URL", "http://localhost:8004").rstrip("/")
_SYSTEMS_TIMEOUT = float(os.getenv("CORE_SYSTEMS_TIMEOUT", "10"))


def _tokenize(text: str) -> str:
    return " ".join("".join(c.lower() if c.isalnum() else " " for c in text).split())


def _compare(actual: Any, operator: str, required: Any) -> bool:
    """Deterministic indicator: does the actual system value satisfy the rule?"""
    try:
        if operator == "==":
            return actual == required
        if operator == ">=":
            return float(actual) >= float(required)
        if operator == "<=":
            return float(actual) <= float(required)
        if operator == ">":
            return float(actual) > float(required)
        if operator == "<":
            return float(actual) < float(required)
    except (TypeError, ValueError):
        return False
    return False


class CheckCatalog:
    """The verification rulebook: how to validate a MAP against system state."""

    def __init__(self, path: Optional[str] = None):
        self.path = path or _CATALOG_PATH
        if not os.path.exists(self.path):
            logger.warning("%s not found; no checks to run.", self.path)
            self._checks: List[Dict[str, Any]] = []
        else:
            with open(self.path, "r", encoding="utf-8") as f:
                self._checks = json.load(f).get("checks", [])

    def match(self, text: str) -> Optional[Dict[str, Any]]:
        """The check whose keywords best match the MAP text (most hits wins)."""
        hay = _tokenize(text)
        best: Optional[Dict[str, Any]] = None
        best_hits = 0
        for check in self._checks:
            hits = sum(1 for kw in check.get("keywords", []) if kw in hay)
            if hits > best_hits:
                best, best_hits = check, hits
        return best


class SystemsClient:
    """Queries the Core Systems API for the live value of one parameter.

    Returns the actual value, or None if the system/parameter is unreachable
    (so the agent degrades to REVIEW rather than asserting compliance)."""

    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or _SYSTEMS_URL).rstrip("/")

    def actual_value(self, department: str, parameter: str) -> Tuple[Optional[Any], Optional[str]]:
        url = f"{self.base_url}/systems/{urllib.parse.quote(department)}/{urllib.parse.quote(parameter)}"
        try:
            with urllib.request.urlopen(url, timeout=_SYSTEMS_TIMEOUT) as resp:
                payload = json.loads(resp.read())
            return payload.get("actualValue"), payload.get("system")
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            logger.warning("Core Systems query failed (%s/%s): %s", department, parameter, exc)
            return None, None


class _BaseComplianceAgent:
    """Shared validation core. Subclasses set their name for the audit record."""

    name: str = "policy"

    def __init__(self, catalog: Optional[CheckCatalog] = None, systems: Optional[SystemsClient] = None):
        self.catalog = catalog or CheckCatalog()
        self.systems = systems or SystemsClient()

    def verify_map(self, map_obj: Dict[str, Any], now_iso: str) -> Dict[str, Any]:
        haystack = " ".join(str(map_obj.get(k, "")) for k in ("summary", "newObligation", "changeReason"))
        check = self.catalog.match(haystack)

        # No check covers this obligation -> nothing to verify against; human decides.
        if not check:
            return {
                "mapId": map_obj["id"],
                "status": "REVIEW",
                "score": 0.4,
                "verifiedBy": self.name,
                "evidence": [{"kind": "no_check_matched", "ref": "NO_AUTOMATED_CHECK", "timestamp": now_iso}],
            }

        actual, system = self.systems.actual_value(check["department"], check["parameter"])

        # System unreachable / parameter absent -> can't assert compliance; review.
        if actual is None:
            return {
                "mapId": map_obj["id"],
                "status": "REVIEW",
                "score": 0.4,
                "verifiedBy": self.name,
                "evidence": [{
                    "kind": "system_unreachable",
                    "ref": f"{check['department']}.{check['parameter']} (no response)",
                    "timestamp": now_iso,
                }],
            }

        satisfied = _compare(actual, check["operator"], check["requiredValue"])
        status = "PASS" if satisfied else "FAIL"
        score = 0.95 if satisfied else 0.15
        mark = "satisfied" if satisfied else "VIOLATION"
        ref = (
            f"{system or check['department']} :: {check['parameter']} = {actual} "
            f"(required {check['operator']} {check['requiredValue']} {check.get('unit','')}) -> {mark}"
        )
        return {
            "mapId": map_obj["id"],
            "status": status,
            "score": score,
            "verifiedBy": self.name,
            "evidence": [{"kind": "system_query", "ref": ref.strip(), "timestamp": now_iso}],
        }


class TechnicalComplianceAgent(_BaseComplianceAgent):
    """Validates Category A MAPs (system / configuration changes)."""
    name = "technical"


class PolicyComplianceAgent(_BaseComplianceAgent):
    """Validates Category B MAPs (policy / document changes)."""
    name = "policy"


class VerificationEngine:
    """Dispatches each MAP to the agent that owns its category, then validates
    against the live Core Systems state."""

    def __init__(self, catalog: Optional[CheckCatalog] = None, systems: Optional[SystemsClient] = None):
        catalog = catalog or CheckCatalog()
        systems = systems or SystemsClient()
        self.technical = TechnicalComplianceAgent(catalog, systems)
        self.policy = PolicyComplianceAgent(catalog, systems)

    def _agent_for(self, category: Optional[str]) -> _BaseComplianceAgent:
        return self.technical if (category or "").strip().lower() == "technical" else self.policy

    def verify_map(self, map_obj: Dict[str, Any], now_iso: str) -> Dict[str, Any]:
        return self._agent_for(map_obj.get("category")).verify_map(map_obj, now_iso)
