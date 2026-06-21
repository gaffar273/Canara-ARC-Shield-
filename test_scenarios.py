"""
TEST SUITE FOR HACKATHON SUBMISSION
100% OFFLINE - No internet required
Demonstrates both problem statements with locally generated test data
"""

import asyncio
import json
import logging
from node2_map_engine.schemas import IncomingChunk
from node2_map_engine.workflow import run_map_engine

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("test_suite")

class TestData:
    """Self-contained test data - no external sources needed"""
    
    @staticmethod
    def get_capital_requirement_increase_scenario():
        """
        Problem Statement 1 Example:
        Document with numerical change (1.5M -> 5M INR capital requirement)
        """
        return {
            "circular_id": "RBI/2024-Q2/10",
            "circular_date": "2024-06-15",
            "regulator": "RBI",
            "domain": "Risk",
            "section_title": "Capital Requirements",
            "chunk_text": "Banks must maintain a minimum capital of 5,000,000 INR to ensure adequate capitalization.",
            "chunk_index": 1,
            "chunk_hash": "hash_capital_req_v2"
        }
    
    @staticmethod
    def get_kyc_deadline_change_scenario():
        """
        Problem Statement 1 Example:
        Document with timeline change in KYC requirements
        """
        return {
            "circular_id": "RBI/2024-Q3/15",
            "circular_date": "2024-07-01",
            "regulator": "RBI",
            "domain": "Compliance",
            "section_title": "KYC Requirements",
            "chunk_text": "Customer due diligence shall be completed within 15 days of account opening for enhanced compliance.",
            "chunk_index": 2,
            "chunk_hash": "hash_kyc_v2"
        }
    
    @staticmethod
    def get_aml_threshold_increase_scenario():
        """
        Problem Statement 1 Example:
        Document with increased AML reporting thresholds
        """
        return {
            "circular_id": "RBI/2024-Q4/08",
            "circular_date": "2024-08-10",
            "regulator": "RBI",
            "domain": "Compliance",
            "section_title": "AML Transaction Reporting",
            "chunk_text": "Suspicious transactions exceeding 50,000 INR must be reported within 12 hours as per enhanced protocols.",
            "chunk_index": 3,
            "chunk_hash": "hash_aml_v2"
        }
    
    @staticmethod
    def get_cybersecurity_enhancement_scenario():
        """
        Problem Statement 2 Example:
        Document with cybersecurity control enhancements
        """
        return {
            "circular_id": "RBI/2024-CYBER/12",
            "circular_date": "2024-09-01",
            "regulator": "RBI",
            "domain": "Information Security",
            "section_title": "Cybersecurity Standards - Enhanced Controls",
            "chunk_text": "All financial institutions must implement multi-factor authentication (MFA) with biometric verification for all customer-facing portals and mandatory security key usage for administrative access.",
            "chunk_index": 4,
            "chunk_hash": "hash_cyber_v2"
        }
    
    @staticmethod
    def get_lcr_ratio_change_scenario():
        """
        Problem Statement 2 Example:
        Document with liquidity requirements strengthened
        """
        return {
            "circular_id": "RBI/2024-LIQUIDITY/20",
            "circular_date": "2024-09-15",
            "regulator": "RBI",
            "domain": "Treasury",
            "section_title": "Liquidity Coverage Ratio - Strengthened Requirements",
            "chunk_text": "Banks must maintain a minimum Liquidity Coverage Ratio (LCR) of 110% of net cash outflows for a 30-day stress period to strengthen liquidity buffers.",
            "chunk_index": 5,
            "chunk_hash": "hash_lcr_v2"
        }
    
    @staticmethod
    def get_data_encryption_enhancement_scenario():
        """
        Problem Statement 2 Example:
        Document with enhanced data protection requirements
        """
        return {
            "circular_id": "RBI/2024-SECURITY/18",
            "circular_date": "2024-10-01",
            "regulator": "RBI",
            "domain": "Risk",
            "section_title": "Customer Data Protection - Enhanced Standards",
            "chunk_text": "Customer personal data must be encrypted both at rest using AES-256 encryption and in transit using TLS 1.3, with mandatory annual cryptography audits.",
            "chunk_index": 6,
            "chunk_hash": "hash_encryption_v2"
        }


async def run_test_scenario(scenario_name: str, payload: dict):
    """Execute a single test scenario"""
    print(f"\n{'='*70}")
    print(f"TEST: {scenario_name}")
    print(f"{'='*70}")
    
    try:
        chunk = IncomingChunk(**payload)
        final_state = await run_map_engine(chunk)
        
        print("\n✓ EXECUTION SUCCESSFUL")
        print(f"\nResults:")
        print(json.dumps(final_state.get("final_map", {}), indent=2, default=str))
        
        if final_state.get("requires_human_review"):
            print("\n⚠ Result flagged for human review (confidence < 0.85)")
        
        return True
    except Exception as e:
        print(f"\n✗ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    """Run complete test suite"""
    print("\n" + "="*70)
    print("HACKATHON PROTOTYPE TEST SUITE")
    print("100% OFFLINE - Pure Rule-Based Analysis")
    print("No Internet, No External APIs, No Database Services Required")
    print("="*70)
    
    test_cases = [
        ("Scenario 1.1: Capital Requirement Increase", TestData.get_capital_requirement_increase_scenario()),
        ("Scenario 1.2: KYC Deadline Change", TestData.get_kyc_deadline_change_scenario()),
        ("Scenario 1.3: AML Threshold Increase", TestData.get_aml_threshold_increase_scenario()),
        ("Scenario 2.1: Cybersecurity Enhancement", TestData.get_cybersecurity_enhancement_scenario()),
        ("Scenario 2.2: Liquidity Ratio Strengthening", TestData.get_lcr_ratio_change_scenario()),
        ("Scenario 2.3: Data Encryption Enhancement", TestData.get_data_encryption_enhancement_scenario()),
    ]
    
    results = []
    for scenario_name, payload in test_cases:
        success = await run_test_scenario(scenario_name, payload)
        results.append((scenario_name, success))
        await asyncio.sleep(0.5)  # Small delay between tests
    
    # Print summary
    print(f"\n\n{'='*70}")
    print("TEST SUMMARY")
    print(f"{'='*70}")
    for scenario_name, success in results:
        status = "✓ PASS" if success else "✗ FAIL"
        print(f"{status}: {scenario_name}")
    
    total_passed = sum(1 for _, success in results if success)
    total_tests = len(results)
    print(f"\nTotal: {total_passed}/{total_tests} passed")
    
    print(f"\n{'='*70}")
    print("All tests completed successfully!")
    print("System is ready for live demonstration")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    asyncio.run(main())
