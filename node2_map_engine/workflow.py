import sys
import uuid
import logging
import difflib
import json
import os
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
from node2_map_engine.identifier import PolicyIdentifier

logger = logging.getLogger("node2.workflow")

# Configure a beautiful terminal output logger
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(message)s')
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)
logger.setLevel(logging.INFO)

async def run_map_engine(
    chunk: IncomingChunk, baseline: Optional[List[Dict[str, Any]]] = None
) -> Node2State:
    """
    Orchestration flow using 3-Signal Identification:
    1. Run PolicyIdentifier to match the chunk to any old policy.
    2. Check verdict: UNCHANGED, MODIFIED, AMBIGUOUS, or ADDED.
    3. Generate diff text.
    4. Run rule extraction (LLM or Mock) & department mapping.
    5. Save final compliance MAP to DB.
    """
    
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
    identifier = PolicyIdentifier()
    
    from node2_map_engine.deterministic_mapper import DeterministicRuleMapper
    _TAXONOMY_PATH = os.path.join(os.path.dirname(__file__), "rule_taxonomy.json")
    rule_mapper = DeterministicRuleMapper(_TAXONOMY_PATH)
    
    def normalize_to_policy_type(domain: str) -> str:
        d = domain.upper()
        if "KYC" in d: return "KYC"
        if "AML" in d: return "AML"
        if "CFT" in d: return "CFT"
        if "CYBER" in d or "INFOSEC" in d or "SECURITY" in d: return "CYBERSECURITY"
        if "PRIVACY" in d or "DATA PROTECTION" in d: return "DATA_PROTECTION"
        if "PAYMENT" in d: return "PAYMENTS"
        if "CREDIT" in d: return "CREDIT_RISK"
        if "OPERATIONAL" in d: return "OPERATIONAL_RISK"
        return "KYC"

    try:
        # STEP 1: Run Policy Identifier (3-Signal Match)
        # The caller-supplied baseline (clauses of the circulars this one cites)
        # is the authoritative prior version, searched ahead of the stored history.
        id_result = identifier.identify(
            new_text=chunk.chunk_text,
            section_title=chunk.section_title,
            circular_id=chunk.circular_id,
            baseline_clauses=baseline,
        )
        
        verdict = id_result["verdict"]
        matched_clause = id_result["matched_clause"]
        signal_used = id_result["signal"]
        similarity_score = id_result["similarity"]
        needs_review = id_result["needs_review"]
        
        state["requires_human_review"] = needs_review
        
        # Determine signal description for printing
        signal_desc = "Unknown"
        if signal_used == "circular_ref":
            signal_desc = "Circular Reference ID Match"
        elif signal_used == "section_title":
            signal_desc = "Section Title / Paragraph Number Exact Match"
        elif signal_used == "semantic":
            signal_desc = f"Semantic Similarity (Score: {similarity_score:.4f})"
        elif signal_used == "fallback":
            signal_desc = "None (All Signals Failed - Genuinely New Policy)"

        # Prepare for diffing
        old_text = ""
        old_file = "None"
        old_section = "None"
        hash_compare_status = "N/A"
        
        if matched_clause:
            old_text = matched_clause.get("raw_text", "")
            old_file = matched_clause.get("source", "SEED") + " DB"
            old_section = matched_clause.get("section_title", "")
            
            # Compare hashes
            new_text_normalized = normalizer.normalize_for_hash(chunk.chunk_text)
            new_hash = HashingEngine.generate_hash(new_text_normalized)
            old_text_norm = normalizer.normalize_for_hash(old_text)
            old_hash = HashingEngine.generate_hash(old_text_norm)
            
            if new_hash == old_hash:
                hash_compare_status = "MATCH → text is identical"
                state["hash_match"] = True
                state["candidate_old_clause"] = matched_clause
            else:
                hash_compare_status = "MISMATCH → text changed"
        else:
            hash_compare_status = "N/A (No old policy to compare)"
        
        # Pretty print the evaluation box for the judges
        print("\n" + "═" * 70)
        print(f"Chunk: \"{chunk.section_title}\"")
        print("Identification result:")
        print(f"  Signal used : {signal_desc}")
        print(f"  Matched to  : {old_section} (Domain: {id_result['domain']})")
        print(f"  Similarity  : {similarity_score:.4f}")
        print(f"  Hash compare: {hash_compare_status}")
        print(f"  Verdict     : {verdict}")
        print("─" * 70)

        if verdict == "UNCHANGED":
            print("  Status: UNCHANGED. Skipping further analysis.")
            print("═" * 70 + "\n")
            return state

        # STEP 2: Diffing
        if verdict in ["MODIFIED", "AMBIGUOUS"]:
            diff_text = DiffingEngine.generate_diff(old_text, chunk.chunk_text)
            state["diff_text"] = diff_text
            state["candidate_old_clause"] = matched_clause
            
            # Show diff in green (+) and red (-)
            print("Sentence Diff:")
            for line in diff_text.split("\n"):
                if line.startswith("+"):
                    print(f"  \033[92m{line}\033[0m")  # Green for addition
                elif line.startswith("-"):
                    print(f"  \033[91m{line}\033[0m")  # Red for removal
                else:
                    print(f"  {line}")
        else:
            diff_text = f"+ {chunk.chunk_text}"
            state["diff_text"] = diff_text
            print("NEW REGULATION DETECTED - Full Text Added:")
            print(f"  \033[92m+ {chunk.chunk_text}\033[0m")
            
        print("─" * 70)

        # STEP 3: Rule Extraction & Department Mapping
        # LLM Evaluation
        llm_response = await llm.evaluate_diff(old_text, chunk.chunk_text, diff_text)
        state["llm_map_draft"] = llm_response
        
        # Deterministic Department Routing
        department = RuleEngine.assign_department(id_result["domain"], llm_response.get("summary", ""))
        
        # Check rule taxonomy map for refined department mapping
        policy_type = normalize_to_policy_type(id_result["domain"])
        extracted_rules = rule_mapper.extract_rules_from_chunk(chunk.chunk_text, policy_type)
        if extracted_rules:
            best_rule = extracted_rules[0]
            dept_map = rule_mapper.map_rule_to_department(best_rule.rule_type, best_rule.confidence)
            if dept_map:
                department = dept_map.primary_department
                
        confidence = float(llm_response.get("confidence", 0.85))
        
        final_map_obj = MAP(
            map_id=str(uuid.uuid4()),
            clause_ref=matched_clause["clause_id"] if matched_clause else "NEW",
            change_type="MODIFIED" if verdict in ["MODIFIED", "AMBIGUOUS"] else "ADDED",
            change_reason=llm_response.get("change_reason", "Regulatory update compliance."),
            impact=llm_response.get("impact", "MEDIUM"),
            summary=llm_response.get("summary", "Compliance obligation parsed."),
            old_obligation=old_text if old_text else None,
            new_obligation=chunk.chunk_text,
            affected_department=department,
            deadline=datetime.utcnow(),
            source_circular=chunk.circular_id,
            confidence=confidence
        )
        
        state["final_map"] = final_map_obj.model_dump()

        # STEP 4: Save to Database
        storage.save_map(state["final_map"], needs_review)

        # STEP 5: Persist updated/new clause to close the loop
        storage.save_historical_clause({
            "clause_id": f"{chunk.circular_id}::{chunk.chunk_index}",
            "circular_id": chunk.circular_id,
            "circular_date": chunk.circular_date,
            "domain": id_result["domain"],
            "section_title": chunk.section_title,
            "raw_text": chunk.chunk_text,
            "created_at": datetime.utcnow().isoformat(),
            "source": chunk.regulator,
        })
        
        print(f"Compliance MAP successfully generated & saved.")
        print(f"Assigned Department: {department}")
        print("═" * 70 + "\n")
        return state
        
    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        state["errors"].append(str(e))
        return state

# ---- Command Line Runner & Demo Interface -----------------------------------

async def run_pipeline_demo():
    print("=" * 70)
    print("Starting Canara Compliance Shield 3-Signal Demo Pipeline")
    print("Running fully offline using local database & offline models.")
    print("=" * 70 + "\n")
    
    # 1. Test modified policies circular
    modified_path = "/home/aarushi/Canara-ARC-Shield-/data/circulars/circular_modified.json"
    if os.path.exists(modified_path):
        print("\n>>> Scenario 1: Processing MODIFIED circular guidelines...")
        with open(modified_path, "r") as f:
            data = json.load(f)
        for i, chunk_data in enumerate(data["chunks"]):
            chunk = IncomingChunk(
                circular_id=data["circular_id"],
                circular_date=data["circular_date"],
                regulator=data["regulator"],
                domain="UNKNOWN",
                section_title=chunk_data["section_title"],
                chunk_text=chunk_data["text"],
                chunk_index=i,
                chunk_hash=f"hash_mod_{i}"
            )
            await run_map_engine(chunk)

    # 2. Test unchanged policy circular
    unchanged_path = "/home/aarushi/Canara-ARC-Shield-/data/circulars/circular_unchanged.json"
    if os.path.exists(unchanged_path):
        print("\n>>> Scenario 2: Processing UNCHANGED circular guidelines...")
        with open(unchanged_path, "r") as f:
            data = json.load(f)
        for i, chunk_data in enumerate(data["chunks"]):
            chunk = IncomingChunk(
                circular_id=data["circular_id"],
                circular_date=data["circular_date"],
                regulator=data["regulator"],
                domain="UNKNOWN",
                section_title=chunk_data["section_title"],
                chunk_text=chunk_data["text"],
                chunk_index=i,
                chunk_hash=f"hash_unchange_{i}"
            )
            await run_map_engine(chunk)

    # 3. Test new policy circular
    new_path = "/home/aarushi/Canara-ARC-Shield-/data/circulars/circular_new.json"
    if os.path.exists(new_path):
        print("\n>>> Scenario 3: Processing BRAND NEW circular guidelines...")
        with open(new_path, "r") as f:
            data = json.load(f)
        for i, chunk_data in enumerate(data["chunks"]):
            chunk = IncomingChunk(
                circular_id=data["circular_id"],
                circular_date=data["circular_date"],
                regulator=data["regulator"],
                domain="UNKNOWN",
                section_title=chunk_data["section_title"],
                chunk_text=chunk_data["text"],
                chunk_index=i,
                chunk_hash=f"hash_new_{i}"
            )
            await run_map_engine(chunk)

if __name__ == "__main__":
    import asyncio
    if "--seed" in sys.argv:
        print("Command received: Seeding Policy database...")
        from node2_map_engine.seed_policies import seed_database
        seed_database()
    else:
        # Default: run pipeline demonstration
        # Force mock LLM for local evaluation without Ollama running
        os.environ["USE_MOCK_LLM"] = "true"
        asyncio.run(run_pipeline_demo())
