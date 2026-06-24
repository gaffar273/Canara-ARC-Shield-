import uuid
import logging
import difflib
from datetime import datetime
from typing import Optional, List, Dict, Any
try:
    from typing import TypedDict
except ImportError:
    from typing_extensions import TypedDict

class Node2State(TypedDict):
    new_chunk: Dict[str, Any]
    candidate_old_clause: Optional[Dict[str, Any]]
    hash_match: bool
    diff_text: str
    llm_map_draft: Optional[Dict[str, Any]]
    final_map: Optional[Dict[str, Any]]
    requires_human_review: bool
    errors: List[str]
from node2_map_engine.schemas import IncomingChunk, MAP
from node2_map_engine.engine import StandardTextNormalizer, HashingEngine, DiffingEngine, RuleEngine
from node2_map_engine.storage import StorageInterface
from node2_map_engine.llm import LLMEngine

logger = logging.getLogger(__name__)

# A cited circular's clause whose text overlaps the incoming clause at/above this
# ratio is treated as the prior version being amended. Lower than the semantic
# store's bar because an explicit citation already established the relationship;
# we only need to align which clause maps to which.
_BASELINE_MATCH_THRESHOLD = 0.50


def _match_baseline(
    chunk: IncomingChunk, baseline: Optional[List[Dict[str, Any]]]
) -> Optional[Dict[str, Any]]:
    """Find the prior version of this clause among the explicitly cited circulars.

    A citation ("this circular amends RBI/.../X") is an authoritative signal,
    stronger than the semantic store's fuzzy similarity, so it is consulted
    first. Exact section metadata wins; otherwise the best text overlap above
    the threshold is taken.
    """
    if not baseline:
        return None
    for cand in baseline:
        if cand.get("domain") == chunk.domain and cand.get("section_title") == chunk.section_title:
            return cand
    best: Optional[Dict[str, Any]] = None
    best_ratio = 0.0
    for cand in baseline:
        ratio = difflib.SequenceMatcher(None, chunk.chunk_text, cand.get("raw_text", "")).ratio()
        if ratio > best_ratio:
            best_ratio, best = ratio, cand
    return best if best_ratio >= _BASELINE_MATCH_THRESHOLD else None


async def run_map_engine(
    chunk: IncomingChunk, baseline: Optional[List[Dict[str, Any]]] = None
) -> Node2State:
    """
    The main orchestration function. Represents the LangGraph execution flow.

    `baseline` holds clauses from circulars this one explicitly cites (resolved
    by the backend from the reference graph). When present it is the
    authoritative source of the prior clause version; the semantic store is only
    a fallback for clauses the citation did not cover.
    """
    logger.info(f"--- Starting Node 2 Pipeline for Chunk {chunk.chunk_index} ---")
    
    # Initialize State
    state: Node2State = {
        "new_chunk": chunk.model_dump(),
        "candidate_old_clause": None,
        "hash_match": False,
        "diff_text": "",
        "llm_map_draft": None,
        "final_map": None,
        "requires_human_review": False,
        "errors": []
    }
    
    # Initialize Dependencies
    storage = StorageInterface()
    normalizer = StandardTextNormalizer()
    llm = LLMEngine()
    
    try:
        # STEP 1: Retrieval. An explicit citation is authoritative, so the cited
        # circulars' clauses are consulted first; the semantic store over all
        # history is only the fallback for clauses the citation did not cover.
        # Either way, never match the circular against its own clauses.
        old_clause = _match_baseline(chunk, baseline)
        if not old_clause:
            old_clause = storage.find_historical_clause(
                chunk.domain, chunk.section_title, exclude_circular=chunk.circular_id
            )
        if not old_clause:
            # Fallback to Vector Search
            old_clause = storage.vector_search_clause(
                chunk.chunk_text, exclude_circular=chunk.circular_id
            )

        if not old_clause:
            logger.info("No historical clause found. Treating as completely new addition.")
            # In a real scenario, we might skip the diffing and just treat it as ADDED
        else:
            state["candidate_old_clause"] = old_clause
            
        # STEP 2: Normalization & Hashing
        new_text_normalized = normalizer.normalize_for_hash(chunk.chunk_text)
        new_hash = HashingEngine.generate_hash(new_text_normalized)
        
        old_text = ""
        old_hash = ""
        if old_clause:
            old_text = old_clause["raw_text"]
            old_text_normalized = normalizer.normalize_for_hash(old_text)
            old_hash = HashingEngine.generate_hash(old_text_normalized)
            
        # STEP 3: Compare
        if old_clause and new_hash == old_hash:
            logger.info("Hashes match exactly. No regulatory change detected. Skipping.")
            state["hash_match"] = True
            return state
            
        # STEP 4: Diffing
        diff_text = DiffingEngine.generate_diff(old_text, chunk.chunk_text)
        state["diff_text"] = diff_text
        
        # STEP 5: LLM Evaluation
        llm_response = await llm.evaluate_diff(old_text, chunk.chunk_text, diff_text)
        state["llm_map_draft"] = llm_response
        
        # STEP 6: Routing & MAP Construction
        department = RuleEngine.assign_department(chunk.domain, llm_response.get("summary", ""))
        
        confidence = float(llm_response.get("confidence", 0.0))
        requires_review = confidence < 0.85
        state["requires_human_review"] = requires_review
        
        if requires_review:
            logger.warning(f"Low confidence ({confidence}). Routing to human queue.")
            
        final_map_obj = MAP(
            map_id=str(uuid.uuid4()),
            clause_ref=old_clause["clause_id"] if old_clause else "NEW",
            change_type=llm_response["change_type"],
            change_reason=llm_response["change_reason"],
            impact=llm_response["impact"],
            summary=llm_response["summary"],
            old_obligation=old_text if old_text else None,
            new_obligation=chunk.chunk_text,
            affected_department=department,
            deadline=datetime.utcnow(),
            source_circular=chunk.circular_id,
            confidence=confidence
        )
        
        state["final_map"] = final_map_obj.model_dump()

        # STEP 7: Save to DB
        storage.save_map(state["final_map"], requires_review)

        # STEP 8: Persist this clause as history so future circulars (its
        # amendments) can diff against it. Deterministic id => reprocessing the
        # same circular overwrites rather than duplicates. This closes the loop:
        # today's obligation becomes tomorrow's baseline.
        storage.save_historical_clause({
            "clause_id": f"{chunk.circular_id}::{chunk.chunk_index}",
            "circular_id": chunk.circular_id,
            "circular_date": chunk.circular_date,
            "domain": chunk.domain,
            "section_title": chunk.section_title,
            "raw_text": chunk.chunk_text,
            "created_at": datetime.utcnow().isoformat(),
            "source": chunk.regulator,
        })

        logger.info("--- Node 2 Pipeline Completed Successfully ---")
        return state
        
    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        state["errors"].append(str(e))
        return state
