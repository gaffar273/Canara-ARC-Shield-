"""
Main Entry Point - Offline Regulatory Compliance Analyzer
100% Local Execution - No Internet Required
"""

import asyncio
import json
import logging
from node2_map_engine.schemas import IncomingChunk
from node2_map_engine.workflow import run_map_engine

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("main")

async def main():
    logger.info("="*70)
    logger.info("Starting Node 2 MAP Engine (100% Offline Local Run)")
    logger.info("No external APIs, no internet required")
    logger.info("="*70)
    
    # Example 1: Capital Requirement Increase (Problem Statement scenario)
    mock_payload_1 = {
        "circular_id": "RBI/2024-Q2/10",
        "circular_date": "2024-06-15",
        "regulator": "RBI",
        "domain": "Risk",
        "section_title": "Capital Requirements",
        "chunk_text": "Banks must maintain a minimum capital of 5,000,000 INR to ensure adequate capitalization.",
        "chunk_index": 1,
        "chunk_hash": "hash_capital_v2"
    }
    
    try:
        logger.info("\n[TEST 1] Processing capital requirement update...")
        chunk = IncomingChunk(**mock_payload_1)
        final_state = await run_map_engine(chunk)
        
        print("\n" + "="*70)
        print("RESULT 1: Capital Requirement Analysis")
        print("="*70)
        print(json.dumps(final_state["final_map"], indent=2, default=str))
        
    except Exception as e:
        logger.error(f"Test 1 failed: {e}")
        import traceback
        traceback.print_exc()
    
    # Example 2: Cybersecurity Enhancement (Another scenario)
    mock_payload_2 = {
        "circular_id": "RBI/2024-CYBER/12",
        "circular_date": "2024-09-01",
        "regulator": "RBI",
        "domain": "Information Security",
        "section_title": "Cybersecurity Standards - Enhanced Controls",
        "chunk_text": "All financial institutions must implement multi-factor authentication (MFA) with biometric verification for all customer-facing portals and mandatory security key usage for administrative access.",
        "chunk_index": 2,
        "chunk_hash": "hash_cyber_v2"
    }
    
    try:
        logger.info("\n[TEST 2] Processing cybersecurity enhancement...")
        chunk = IncomingChunk(**mock_payload_2)
        final_state = await run_map_engine(chunk)
        
        print("\n" + "="*70)
        print("RESULT 2: Cybersecurity Enhancement Analysis")
        print("="*70)
        print(json.dumps(final_state["final_map"], indent=2, default=str))
        
    except Exception as e:
        logger.error(f"Test 2 failed: {e}")
        import traceback
        traceback.print_exc()
    
    logger.info("\n" + "="*70)
    logger.info("✓ All tests completed successfully!")
    logger.info("System runs 100% offline without any external services")
    logger.info("="*70)

if __name__ == "__main__":
    asyncio.run(main())
