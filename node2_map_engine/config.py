"""
Configuration for Node 2 MAP Engine.

The MAP engine analyses a regulatory change (old clause vs new clause) and emits
a structured verdict. The analysis is backed by an LLM when one is configured
(any OpenAI-compatible /chat/completions endpoint, e.g. a local Ollama), and
falls back to a deterministic rule-based analyzer whenever the model is disabled
or unreachable — so the pipeline never blocks.

LLM settings are exposed as lazy getters (read at call time, not import time),
mirroring Node 1. node2_map_engine/.env is loaded if present; real environment
variables always win.
"""

import os
from pathlib import Path

from pydantic_settings import BaseSettings

_ENV_PATH = Path(__file__).resolve().parent / ".env"


def _load_env_file() -> None:
    """Minimal .env loader. Real environment variables always win (setdefault)."""
    if not _ENV_PATH.exists():
        return
    for raw in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()


class Settings(BaseSettings):
    """File-based storage + engine thresholds. LLM settings live in the lazy
    getters below (read at call time)."""

    DATABASE_PATH: str = "./mock_db.json"
    SIMILARITY_THRESHOLD: float = 0.80
    CONFIDENCE_THRESHOLD: float = 0.85

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()


def llm_url() -> str:
    return os.getenv("NODE2_LLM_URL", "").strip()


def llm_key() -> str:
    return os.getenv("NODE2_LLM_KEY", "").strip()


def llm_model() -> str:
    return os.getenv("NODE2_LLM_MODEL", "deepseek-r1:8b").strip()


def llm_no_think() -> bool:
    """Disable a reasoning model's hidden <think> phase for this scoped task."""
    return os.getenv("NODE2_LLM_NO_THINK", "false").strip().lower() in {"1", "true", "yes"}


def llm_enabled() -> bool:
    """The LLM analyzer is used only when a URL is set and the flag is not off.
    Otherwise the deterministic rule-based analyzer handles the change analysis."""
    if not llm_url():
        return False
    return os.getenv("NODE2_LLM_ENABLED", "true").strip().lower() in {"1", "true", "yes"}


def llm_timeout() -> float:
    try:
        return float(os.getenv("NODE2_LLM_TIMEOUT", "60"))
    except ValueError:
        return 60.0
