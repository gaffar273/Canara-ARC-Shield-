import json
import logging
import os
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

class StorageInterface:
    """
    Interface for data persistence.
    Locally, this reads and writes to a mock_db.json file.
    In production, this would implement SQLAlchemy for Postgres.
    """
    
    def __init__(self, db_path: str = "mock_db.json"):
        self.db_path = db_path
        # Ensure the mock DB exists
        if not os.path.exists(self.db_path):
            logger.warning(f"{self.db_path} not found. Creating a blank mock database.")
            self._save_db({"clauses": {}, "compliance_maps": [], "human_review_queue": []})

    def _load_db(self) -> Dict[str, Any]:
        with open(self.db_path, "r") as f:
            return json.load(f)
            
    def _save_db(self, data: Dict[str, Any]):
        with open(self.db_path, "w") as f:
            json.dump(data, f, indent=2)

    def find_historical_clause(self, domain: str, section_title: str) -> Optional[Dict[str, Any]]:
        """
        Attempts to find the old clause using exact metadata match (Postgres).
        """
        logger.info(f"Querying Mock DB for Domain: {domain}, Section: {section_title}")
        db = self._load_db()
        
        for clause in db.get("clauses", {}).values():
            if clause["domain"] == domain and clause["section_title"] == section_title:
                logger.info("Found historical clause via metadata match.")
                return clause
                
        return None

    def vector_search_clause(self, text: str) -> Optional[Dict[str, Any]]:
        """
        Fallback: If metadata match fails, search ChromaDB using text embeddings.
        """
        logger.info("Metadata match failed. Falling back to ChromaDB vector search.")
        # We leave this mocked as returning None for the local JSON implementation
        logger.info("Vector search yielded no high-confidence results.")
        return None

    def save_map(self, map_data: Dict[str, Any], requires_review: bool):
        """
        Saves the final generated MAP to the mock JSON DB.
        """
        db = self._load_db()
        
        target_table = "human_review_queue" if requires_review else "compliance_maps"
        logger.info(f"Saving MAP {map_data.get('map_id')} to table: {target_table}")
        
        # Append the new MAP to the appropriate list
        if target_table not in db:
            db[target_table] = []
            
        # Convert datetime objects to strings before saving to JSON
        import datetime
        for key, value in map_data.items():
            if isinstance(value, datetime.datetime):
                map_data[key] = value.isoformat()

        db[target_table].append(map_data)
        
        # Save the file
        self._save_db(db)
        logger.info("Mock DB successfully updated.")
