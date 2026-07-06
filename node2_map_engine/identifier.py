import re
import logging
from typing import Dict, Any, Optional, List, Tuple
from node2_map_engine.policy_retriever import PolicyRetriever, compute_cosine_similarity, embed_text
from node2_map_engine.engine import HashingEngine, StandardTextNormalizer

logger = logging.getLogger("node2.identifier")

# Circular reference regex patterns
CIRCULAR_REF_PATTERNS = [
    r'amends?\s+(?:circular\s+)?([A-Z]+\.[\w.\/]+\d{4})',  # e.g., "amends DBOD.No.47/2024"
    r'in\s+supersession\s+of\s+([A-Z]+\.[\w.\/]+\d{4})',  # e.g., "in supersession of..."
    r'referred\s+to\s+in\s+circular\s+([A-Z]+\.[\w.\/]+\d{4})',  # e.g., "referred to in circular..."
    r'([A-Z]+\.[A-Z]+\.BC\.No\.\d+\/\d{4}-\d{2,4})',  # standard RBI format
]

# Domain keyword mapping for fallback classification of brand-new regulations
DOMAIN_KEYWORDS: List[Tuple[str, List[str]]] = [
    ("KYC", ["know your customer", "kyc", "ckyc", "customer identification", "v-cip", "video kyc", "customer due diligence"]),
    ("AML", ["anti-money laundering", "aml", "pmla", "suspicious transaction", "financial intelligence", "money laundering", "fiu-ind", "ctr", "str"]),
    ("FOREX", ["foreign exchange", "forex", "fema", "net open position", "authorised dealer", "fcnr", "ecb", "remittance", "lrs"]),
    ("CYBERSECURITY", ["cybersecurity", "cyber", "information security", "data breach", "incident response", "soc", "encryption", "mfa", "tls"]),
    ("CREDIT_RISK", ["loan", "credit", "npa", "non-performing", "provisioning", "restructuring", "lending"]),
]

def extract_circular_references(text: str) -> List[str]:
    """Extracts standard RBI circular references from text."""
    refs = []
    for pattern in CIRCULAR_REF_PATTERNS:
        matches = re.findall(pattern, text, re.IGNORECASE)
        refs.extend(matches)
    return list(set(refs))

def normalize_section_title(title: str) -> str:
    """Normalizes section title for matching (e.g. 'Paragraph 65' -> 'paragraph_65')"""
    title_lower = title.lower()
    # Extract structural markers like Section 12 or Paragraph 65
    match = re.search(r'\b(section|paragraph|para|sec\.?)\s*(\d+)\b', title_lower)
    if match:
        marker_type = "paragraph" if match.group(1) in ["paragraph", "para"] else "section"
        return f"{marker_type}_{match.group(2)}"
    # Fallback: simple slugification
    title_clean = re.sub(r'[^\w\s-]', '', title_lower)
    return re.sub(r'[\s_-]+', '_', title_clean).strip("_")

def keyword_domain_fallback(text: str) -> str:
    """Classifies domain using keywords when all semantic search fails (<0.55 similarity)."""
    text_lower = text.lower()
    for domain, keywords in DOMAIN_KEYWORDS:
        if any(kw in text_lower for kw in keywords):
            return domain
    return "GENERAL"

def strip_markdown_headers(text: str) -> str:
    """Removes leading markdown header lines from the text."""
    if not text:
        return ""
    lines = text.strip().split("\n")
    body_lines = [l for l in lines if not l.strip().startswith("#")]
    return "\n".join(body_lines).strip()

def extract_markdown_heading(text: str) -> str:
    """Returns the first markdown heading in a chunk (e.g. '## Paragraph 18 - Cyber
    Incident Reporting' -> 'Paragraph 18 - Cyber Incident Reporting'), or "".

    The section/paragraph number lives in the chunk's own heading, but callers
    (Node 1) usually pass a composed label like 'Cybersecurity - Incident
    Reporting' that carries no number — so Signal 2 must recover the heading here
    rather than trust the caller-supplied title alone."""
    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
    return ""

class PolicyIdentifier:
    """
    Implements the 3-Signal Policy Identification logic to determine
    whether a circular chunk is MODIFIED, UNCHANGED, or genuinely ADDED (NEW).
    """
    def __init__(self, db_path: str = "mock_db.json"):
        self.retriever = PolicyRetriever(db_path=db_path)
        self.normalizer = StandardTextNormalizer()

    def identify(
        self,
        new_text: str,
        section_title: str,
        circular_id: str = "",
        baseline_clauses: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Runs the 3-Signal matching cascade.
        Returns a dict: {
            "verdict": "UNCHANGED" | "MODIFIED" | "ADDED" | "AMBIGUOUS",
            "domain": str,
            "matched_clause": Optional[Dict],
            "similarity": float,
            "signal": "circular_ref" | "section_title" | "semantic" | "fallback",
            "needs_review": bool
        }

        `baseline_clauses` are the authoritative prior versions supplied by the
        caller (e.g. clauses of the circulars this one explicitly cites). They are
        searched *before* the stored history, so an explicit citation wins over
        the semantic history store.
        """
        logger.info(f"--- Identifying Policy Chunk: '{section_title}' ---")

        # Search the caller-supplied baseline first (authoritative), then fall
        # back to the stored history. Baseline clauses arrive without embeddings.
        clauses = list(baseline_clauses or []) + self.retriever._load_clauses()
        # Exclude clauses from the current circular to avoid self-matching
        if circular_id:
            clauses = [c for c in clauses if c.get("circular_id") != circular_id]

        new_text_clean = strip_markdown_headers(new_text)
        new_text_normalized = self.normalizer.normalize_for_hash(new_text_clean)
        new_hash = HashingEngine.generate_hash(new_text_normalized)

        # -------------------------------------------------------------
        # SIGNAL 1: Circular Reference Match (Auth Reference Link)
        # -------------------------------------------------------------
        refs = extract_circular_references(new_text)
        if refs:
            logger.info(f"Signal 1: Found explicit circular references: {refs}")
            for ref in refs:
                # Look up clauses belonging to referenced circulars
                ref_clauses = [c for c in clauses if c.get("circular_id") == ref]
                if ref_clauses:
                    # Match by normalized section title within the reference circular
                    norm_title = normalize_section_title(section_title)
                    for c in ref_clauses:
                        if normalize_section_title(c.get("section_title", "")) == norm_title:
                            logger.info(f"Signal 1 Match Found: matched section '{c['section_title']}' in circular {ref}")
                            old_text_clean = strip_markdown_headers(c["raw_text"])
                            old_text_norm = self.normalizer.normalize_for_hash(old_text_clean)
                            old_hash = HashingEngine.generate_hash(old_text_norm)
                            
                            verdict = "UNCHANGED" if new_hash == old_hash else "MODIFIED"
                            return {
                                "verdict": verdict,
                                "domain": c["domain"],
                                "matched_clause": c,
                                "similarity": 1.0,
                                "signal": "circular_ref",
                                "needs_review": False
                            }

        # -------------------------------------------------------------
        # SIGNAL 2: Section Title / Paragraph Number Match (Structural Match)
        # -------------------------------------------------------------
        # A clause's structural identity can live in its section_title OR in a
        # markdown heading inside its text — Node 1 stores composed labels like
        # 'Cybersecurity - Incident Reporting' as the title and keeps the real
        # '## Paragraph 18 ...' in the body, so we normalise both sides. A
        # numbered marker ('paragraph_18') is authoritative; a plain slug is only
        # a fallback, so we match structural numbers before slugs — otherwise two
        # clauses that share a composed label would collide on the wrong number.
        def _split_titles(*values: str) -> tuple:
            structural, slug = set(), set()
            for v in values:
                n = normalize_section_title(v)
                if not n:
                    continue
                (structural if re.fullmatch(r"(paragraph|section)_\d+", n) else slug).add(n)
            return structural, slug

        q_struct, q_slug = _split_titles(extract_markdown_heading(new_text), section_title)

        def _title_match(query: set, pick: str):
            # Only a title that resolves to exactly ONE clause is a match. A title
            # that hits several (e.g. many clauses share a composed label) is
            # ambiguous, so we don't guess — Signal 3 compares the actual text.
            hits = [
                c for c in clauses
                if query & (
                    _split_titles(c.get("section_title", ""),
                                  extract_markdown_heading(c.get("raw_text", "")))[0 if pick == "structural" else 1]
                )
            ]
            return hits[0] if len(hits) == 1 else None

        matched_by_title = None
        if q_struct:
            matched_by_title = _title_match(q_struct, "structural")
        if matched_by_title is None and q_slug:
            matched_by_title = _title_match(q_slug, "slug")

        if matched_by_title is not None:
            c = matched_by_title
            logger.info(f"Signal 2 Match Found: Section title match on '{c['section_title']}' (Domain: {c['domain']})")
            old_text_clean = strip_markdown_headers(c["raw_text"])
            old_text_norm = self.normalizer.normalize_for_hash(old_text_clean)
            old_hash = HashingEngine.generate_hash(old_text_norm)

            verdict = "UNCHANGED" if new_hash == old_hash else "MODIFIED"
            return {
                "verdict": verdict,
                "domain": c["domain"],
                "matched_clause": c,
                "similarity": 1.0,
                "signal": "section_title",
                "needs_review": False
            }

        # -------------------------------------------------------------
        # SIGNAL 3: Semantic Similarity (Fallback Match)
        # -------------------------------------------------------------
        # Generate embedding for incoming chunk
        new_emb = embed_text(new_text)
        # Baseline clauses arrive without embeddings; compute them on the fly so
        # the authoritative cited clauses participate in semantic matching too.
        for c in clauses:
            if c.get("embedding") is None and c.get("raw_text"):
                c["embedding"] = embed_text(c["raw_text"])
        clauses_with_emb = [c for c in clauses if c.get("embedding") is not None]

        if new_emb is not None and clauses_with_emb:
            logger.info("Signal 3: Running semantic similarity comparison...")
            import numpy as np
            old_embs = np.array([c["embedding"] for c in clauses_with_emb])
            query_emb = np.array(new_emb)
            
            norms = np.linalg.norm(old_embs, axis=1) * np.linalg.norm(query_emb)
            norms[norms == 0] = 1e-9
            sims = np.dot(old_embs, query_emb) / norms
            
            best_idx = int(np.argmax(sims))
            best_sim = float(sims[best_idx])
            matched = clauses_with_emb[best_idx]
            
            logger.info(f"Signal 3: Closest semantic match is '{matched['section_title']}' with similarity {best_sim:.4f}")

            # Threshold decisions:
            if best_sim >= 0.82:
                # Confident modified/unchanged path
                old_text_clean = strip_markdown_headers(matched["raw_text"])
                old_text_norm = self.normalizer.normalize_for_hash(old_text_clean)
                old_hash = HashingEngine.generate_hash(old_text_norm)
                verdict = "UNCHANGED" if new_hash == old_hash else "MODIFIED"
                return {
                    "verdict": verdict,
                    "domain": matched["domain"],
                    "matched_clause": matched,
                    "similarity": best_sim,
                    "signal": "semantic",
                    "needs_review": False
                }
            elif best_sim >= 0.55:
                # Ambiguous match (requires human verification)
                logger.warning(f"Weak semantic match ({best_sim:.4f}) detected. Flagging for review.")
                return {
                    "verdict": "AMBIGUOUS",
                    "domain": matched["domain"],
                    "matched_clause": matched,
                    "similarity": best_sim,
                    "signal": "semantic",
                    "needs_review": True
                }

        # -------------------------------------------------------------
        # ALL SIGNALS FAIL: Genuinely New Policy
        # -------------------------------------------------------------
        logger.info("All signals failed. Genuinely new policy detected.")
        domain = keyword_domain_fallback(new_text)
        return {
            "verdict": "ADDED",
            "domain": domain,
            "matched_clause": None,
            "similarity": 0.0,
            "signal": "fallback",
            "needs_review": False
        }
