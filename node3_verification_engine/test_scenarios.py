"""
Live smoke test for Node 3's Autonomous Validation Agent.

Requires the Core Systems API running on :8004 (uvicorn core_systems.api:app
--port 8004). Each MAP below is verified by querying the live system state and
comparing it against the regulator's required value — exactly what happens in the
pipeline. Prints the computed verdict + the evidence (actual vs required).

Run:  python -m node3_verification_engine.test_scenarios
"""

from datetime import datetime

from node3_verification_engine.engine import VerificationEngine

NOW = datetime.utcnow().isoformat() + "Z"

# (map, expected_status) — expectations follow from core_systems/systems_state.json
SAMPLES = [
    (
        {
            "id": "MAP-001", "category": "technical",
            "summary": "Extend call recording retention to 3 years",
            "newObligation": "Call recording retention must be at least 3 years",
            "changeReason": "RBI Fair Practices amendment",
        },
        "PASS",  # system has call_recording_retention_years = 3, required >= 3
    ),
    (
        {
            "id": "MAP-002", "category": "technical",
            "summary": "Enable multi-factor authentication on all portals",
            "newObligation": "MFA must be enabled for customer-facing portals",
            "changeReason": "Cyber security directive",
        },
        "PASS",  # mfa_enabled = true
    ),
    (
        {
            "id": "MAP-003", "category": "policy",
            "summary": "Revised risk-weight model must be live",
            "newObligation": "Banks must implement the revised risk weight model",
            "changeReason": "Basel III amendment",
        },
        "FAIL",  # revised_risk_weight_model_active = false
    ),
    (
        {
            "id": "MAP-004", "category": "policy",
            "summary": "Capital adequacy ratio must stay above 11.5%",
            "newObligation": "CRAR shall not fall below 11.5%",
            "changeReason": "Capital adequacy norms",
        },
        "PASS",  # capital_adequacy_ratio_percent = 11.8, required >= 11.5
    ),
    (
        {
            "id": "MAP-005", "category": "policy",
            "summary": "Decision to exclude hedged positions from INR reporting",
            "newObligation": "Directions issued under FEMA with no automated control",
            "changeReason": "FEMA amendment",
        },
        "REVIEW",  # no check matches FEMA reporting -> human
    ),
]


def main() -> None:
    engine = VerificationEngine()
    failures = 0
    print("=" * 78)
    for map_obj, expected in SAMPLES:
        verdict = engine.verify_map(map_obj, NOW)
        ev = verdict["evidence"][0]
        ok = verdict["status"] == expected
        flag = "OK " if ok else "XX "
        if not ok:
            failures += 1
        print(f"[{flag}] {map_obj['id']}  {verdict['status']:<7} "
              f"(expected {expected:<7})  score={verdict['score']}  by={verdict['verifiedBy']}")
        print(f"      evidence: {ev['ref']}")
    print("=" * 78)
    print(f"Done. {len(SAMPLES)} scenarios, {failures} mismatch(es).")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
