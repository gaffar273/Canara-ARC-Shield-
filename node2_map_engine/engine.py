import re
import hashlib
import difflib
import logging
from abc import ABC, abstractmethod

# Configure production-style logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class NormalizationService(ABC):
    @abstractmethod
    def normalize_for_hash(self, text: str) -> str:
        pass

class StandardTextNormalizer(NormalizationService):
    def normalize_for_hash(self, text: str) -> str:
        if not text:
            return ""
        try:
            normalized = text.lower()
            normalized = re.sub(r'\s+', ' ', normalized).strip()
            # Remove commas only when between digits (numeric normalization)
            normalized = re.sub(r'(?<=\d),(?=\d)', '', normalized)
            # Remove trailing punctuation
            normalized = re.sub(r'[.,;!?"\']$', '', normalized)
            return normalized
        except Exception as e:
            logger.error(f"Error normalizing text: {e}")
            raise

class HashingEngine:
    @staticmethod
    def generate_hash(text: str) -> str:
        """Generates a SHA-256 hash of the input text."""
        if not text:
            return ""
        return hashlib.sha256(text.encode('utf-8')).hexdigest()

class DiffingEngine:
    @staticmethod
    def generate_diff(old_text: str, new_text: str) -> str:
        """
        Uses standard library difflib to generate a word-level diff.
        Provides critical context for the LLM.
        """
        if not old_text:
            logger.info("No old text provided; treating as completely new addition.")
            return f"+ {new_text}"
            
        old_words = old_text.split()
        new_words = new_text.split()
        
        diff = difflib.ndiff(old_words, new_words)
        return '\n'.join(diff)

class RuleEngine:
    @staticmethod
    def assign_department(domain: str, summary: str) -> str:
        """
        Deterministic rule-based department routing.
        Avoids unnecessary LLM calls for standard mappings.
        """
        domain_lower = domain.lower()
        
        # Mapping rules
        if "kyc" in domain_lower or "aml" in domain_lower:
            return "Compliance"
        elif "cyber" in domain_lower or "infosec" in domain_lower:
            return "Information Security"
        elif "treasury" in domain_lower or "capital" in domain_lower:
            return "Treasury"
        elif "risk" in domain_lower:
            return "Risk Management"
            
        # Fallback keyword search in summary
        summary_lower = summary.lower()
        if "data privacy" in summary_lower:
            return "Data Privacy Office"
            
        logger.warning(f"Could not route domain '{domain}'. Defaulting to General Legal.")
        return "General Legal"
