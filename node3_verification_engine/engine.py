"""
Node 3 — Verification Engine (offline, rule-based).

Given the compliance MAPs produced by Node 2, this checks each one against a
seeded controls knowledge base (controls_db.json) and emits a verdict:

  - implemented control  -> PASS    (the bank already satisfies the obligation)
  - partial control      -> REVIEW  (control exists but is incomplete)
  - missing control      -> FAIL    (a known gap)
  - no matching control  -> REVIEW  (nothing to verify against; needs a human)

Deterministic by design: the same MAP always yields the same verdict, so the
audit trail holds. No LLM, no internet.
"""

import json
import logging
import os
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("node3.engine")

_STATUS_VERDICT = {
    "implemented": ("PASS", 0.94),
    "partial": ("REVIEW", 0.6),
    "missing": ("FAIL", 0.18),
}


def _tokenize(text: str) -> set:
    return {w for w in "".join(c.lower() if c.isalnum() else " " for c in text).split() if len(w) >= 3}


class ControlsRepository:
    """Reads the seeded controls KB. In production this is the bank's GRC system."""

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or os.path.join(os.path.dirname(__file__), "controls_db.json")
        if not os.path.exists(self.db_path):
            logger.warning("%s not found; verifier has no controls to match against.", self.db_path)
            self._controls: Dict[str, Any] = {}
        else:
            with open(self.db_path, "r") as f:
                self._controls = json.load(f).get("controls", {})

    def all(self) -> List[Dict[str, Any]]:
        return list(self._controls.values())


class VerificationEngine:
    def __init__(self, repo: Optional[ControlsRepository] = None):
        self.repo = repo or ControlsRepository()

    def _best_control(self, department: str, text: str) -> Tuple[Optional[Dict[str, Any]], int]:
        """Pick the control with the most keyword hits; department match breaks ties."""
        terms = _tokenize(text)
        best: Optional[Dict[str, Any]] = None
        best_score = 0
        for control in self.repo.all():
            hits = sum(1 for kw in control.get("keywords", []) if kw in terms)
            if department and control.get("department") == department:
                hits += 1
            if hits > best_score:
                best, best_score = control, hits
        return best, best_score

    def verify_map(self, map_obj: Dict[str, Any], now_iso: str) -> Dict[str, Any]:
        haystack = f"{map_obj.get('summary', '')} {map_obj.get('newObligation', '')} {map_obj.get('changeReason', '')}"
        control, hits = self._best_control(map_obj.get("department", ""), haystack)

        if not control or hits == 0:
            status, score, evidence = "REVIEW", 0.4, [
                {"kind": "no_control_found", "ref": "UNMATCHED", "timestamp": now_iso}
            ]
        else:
            status, score = _STATUS_VERDICT.get(control["status"], ("REVIEW", 0.4))
            evidence = [{
                "kind": control["evidence_kind"],
                "ref": control["evidence_ref"],
                "timestamp": now_iso,
            }]

        # A CRITICAL/HIGH change that only PASSes on a partial match still warrants a look.
        if status == "PASS" and map_obj.get("impact") in ("HIGH", "CRITICAL") and hits < 2:
            status, score = "REVIEW", min(score, 0.7)

        return {
            "mapId": map_obj["id"],
            "status": status,
            "score": round(score, 2),
            "evidence": evidence,
        }
