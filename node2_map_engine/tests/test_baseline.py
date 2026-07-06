from node2_map_engine.schemas import IncomingChunk
from node2_map_engine.workflow import _match_baseline


def _chunk(domain: str, section_title: str, text: str) -> IncomingChunk:
    return IncomingChunk(
        circular_id="CIR-new",
        circular_date="2024-01-01",
        regulator="RBI",
        domain=domain,
        section_title=section_title,
        chunk_text=text,
        chunk_index=0,
        chunk_hash="h",
    )


def _baseline_clause(domain: str, section_title: str, text: str) -> dict:
    return {
        "domain": domain,
        "section_title": section_title,
        "raw_text": text,
        "clause_id": "CIR-old::cited",
        "circular_id": "CIR-old",
    }


def test_no_baseline_returns_none():
    assert _match_baseline(_chunk("KYC", "Periodic Update", "x"), None) is None
    assert _match_baseline(_chunk("KYC", "Periodic Update", "x"), []) is None


def test_exact_section_metadata_wins_over_text_overlap():
    chunk = _chunk("KYC", "Periodic Update", "completely unrelated wording here")
    exact = _baseline_clause("KYC", "Periodic Update", "the prior obligation text")
    similar = _baseline_clause("AML", "Other", "completely unrelated wording here")
    match = _match_baseline(chunk, [similar, exact])
    assert match is exact


def test_text_overlap_above_threshold_matches_when_no_metadata_match():
    chunk = _chunk(
        "Treasury",
        "Exposure Limit",
        "The single borrower exposure limit shall be 20 percent of capital.",
    )
    cand = _baseline_clause(
        "Risk",
        "Limits",
        "The single borrower exposure limit shall be 15 percent of capital.",
    )
    assert _match_baseline(chunk, [cand]) is cand


def test_unrelated_text_below_threshold_returns_none():
    chunk = _chunk("KYC", "Periodic Update", "Customers must refresh KYC every two years.")
    cand = _baseline_clause(
        "Cyber",
        "Incident Reporting",
        "Report cyber incidents to the regulator within six hours of detection.",
    )
    assert _match_baseline(chunk, [cand]) is None
