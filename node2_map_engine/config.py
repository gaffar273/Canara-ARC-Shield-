from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """
    Configuration for Node 2 MAP Engine - Completely Offline
    No external services required: No Ollama, No Postgres, No Chroma
    """
    
    # File-based storage (JSON) - NO external database needed
    DATABASE_PATH: str = "./mock_db.json"
    
    # Pure rule-based analyzer - NO external LLM API needed
    # This is now completely offline and rule-based
    ANALYZER_TYPE: str = "rule_based"
    
    # Engine Settings
    SIMILARITY_THRESHOLD: float = 0.80
    CONFIDENCE_THRESHOLD: float = 0.85
    
    class Config:
        env_file = ".env"

settings = Settings()
