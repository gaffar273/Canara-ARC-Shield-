import uuid
import logging
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

async def run_map_engine(chunk: IncomingChunk) -> Node2State:
    """
    The main orchestration function. Represents the LangGraph execution flow.
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
        # STEP 1: Retrieval
        old_clause = storage.find_historical_clause(chunk.domain, chunk.section_title)
        if not old_clause:
            # Fallback to Vector Search
            old_clause = storage.vector_search_clause(chunk.chunk_text)
            
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
        
        logger.info("--- Node 2 Pipeline Completed Successfully ---")
        return state
        
    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        state["errors"].append(str(e))
        return state
