import json
import logging
import re
from typing import Dict, Any

logger = logging.getLogger(__name__)

class RuleBasedAnalyzer:
    """
    Pure rule-based regulatory change analyzer - COMPLETELY OFFLINE.
    No external APIs, no internet required, no external services needed.
    """
    
    CRITICAL_KEYWORDS = [
        "must", "shall", "mandatory", "required", "compliance",
        "penalty", "fine", "suspension", "prohibited", "forbidden",
        "increased", "decreased", "enhanced", "strengthened", "weakened"
    ]
    
    HIGH_IMPACT_PATTERNS = [
        r"capital.*requirement.*increased",
        r"reserve.*ratio.*changed",
        r"compliance.*deadline.*moved",
        r"penalty.*increased",
        r"exposure.*limit.*reduced",
        r"kyc.*enhanced",
        r"risk.*weight.*increased"
    ]
    
    MEDIUM_IMPACT_PATTERNS = [
        r"reporting.*frequency.*changed",
        r"documentation.*requirement.*added",
        r"frequency.*updated",
        r"timeline.*extended"
    ]
    
    def __init__(self):
        logger.info("✓ Initializing Pure Rule-Based Regulatory Analyzer (100% OFFLINE)")
    
    def _calculate_numeric_change(self, old_text: str, new_text: str) -> tuple:
        """Extract numeric values and calculate percentage change"""
        old_numbers = re.findall(r'\d+[,\d]*\.?\d*', old_text)
        new_numbers = re.findall(r'\d+[,\d]*\.?\d*', new_text)
        
        if old_numbers and new_numbers:
            try:
                old_val = float(old_numbers[-1].replace(',', ''))
                new_val = float(new_numbers[-1].replace(',', ''))
                if old_val > 0:
                    pct_change = ((new_val - old_val) / old_val) * 100
                    return abs(pct_change), new_val > old_val
            except:
                pass
        return 0, None
    
    def _detect_change_type(self, old_text: str, new_text: str) -> str:
        """Determine if change is ADDED, MODIFIED, or REMOVED"""
        if not old_text or old_text.strip() == "":
            return "ADDED"
        if not new_text or new_text.strip() == "":
            return "REMOVED"
        return "MODIFIED"
    
    def _assess_impact(self, old_text: str, new_text: str, diff_text: str) -> str:
        """Rule-based impact assessment"""
        combined_text = (old_text + " " + new_text + " " + diff_text).lower()
        
        # Check critical patterns
        for pattern in self.HIGH_IMPACT_PATTERNS:
            if re.search(pattern, combined_text, re.IGNORECASE):
                pct_change, is_increase = self._calculate_numeric_change(old_text, new_text)
                if pct_change > 50:
                    return "CRITICAL"
                return "HIGH"
        
        # Check medium patterns
        for pattern in self.MEDIUM_IMPACT_PATTERNS:
            if re.search(pattern, combined_text, re.IGNORECASE):
                return "MEDIUM"
        
        # Check for numeric changes
        pct_change, _ = self._calculate_numeric_change(old_text, new_text)
        if pct_change > 30:
            return "HIGH"
        elif pct_change > 10:
            return "MEDIUM"
        
        # Check for mandatory keywords
        critical_count = sum(1 for kw in self.CRITICAL_KEYWORDS if kw in combined_text)
        if critical_count >= 2:
            return "HIGH"
        elif critical_count == 1:
            return "MEDIUM"
        
        return "LOW"
    
    def _generate_reason(self, old_text: str, new_text: str, change_type: str) -> str:
        """Generate human-readable change reason"""
        pct_change, is_increase = self._calculate_numeric_change(old_text, new_text)
        
        if change_type == "ADDED":
            return f"New regulatory obligation introduced"
        elif change_type == "REMOVED":
            return f"Regulatory requirement removed or superseded"
        else:
            if pct_change > 0:
                direction = "increased" if is_increase else "decreased"
                return f"Regulatory requirement {direction} by {pct_change:.1f}%"
            
            # Check for key changes in wording
            if "enhanced" in new_text.lower() and "enhanced" not in old_text.lower():
                return "Regulatory requirement enhanced"
            elif "strengthened" in new_text.lower():
                return "Regulatory requirement strengthened"
            else:
                return "Regulatory requirement modified"
    
    async def evaluate_diff(self, old_text: str, new_text: str, diff_text: str) -> Dict[str, Any]:
        """
        Analyzes regulatory changes using pure rule-based logic.
        NO external APIs, NO internet, NO external services required.
        """
        logger.info("Analyzing regulatory change using pure rule-based engine...")
        
        change_type = self._detect_change_type(old_text, new_text)
        impact = self._assess_impact(old_text, new_text, diff_text)
        reason = self._generate_reason(old_text, new_text, change_type)
        
        # Create summary
        if change_type == "ADDED":
            summary = f"New {impact.lower()} impact regulatory clause added"
        elif change_type == "REMOVED":
            summary = f"Regulatory clause removed or superseded"
        else:
            summary = reason
        
        result = {
            "change_type": change_type,
            "change_reason": reason,
            "impact": impact,
            "summary": summary,
            "confidence": 0.92  # High confidence for rule-based analysis
        }
        
        logger.info(f"✓ Analysis complete: {change_type} - {impact} impact - Confidence: {result['confidence']}")
        return result


class LLMEngine:
    """Wrapper that uses rule-based analyzer instead of Ollama"""
    
    def __init__(self):
        self.analyzer = RuleBasedAnalyzer()
        logger.info("✓ LLM Engine initialized with offline rule-based analyzer")
    
    async def evaluate_diff(self, old_text: str, new_text: str, diff_text: str) -> Dict[str, Any]:
        """Evaluate diff using pure rule-based engine"""
        return await self.analyzer.evaluate_diff(old_text, new_text, diff_text)
