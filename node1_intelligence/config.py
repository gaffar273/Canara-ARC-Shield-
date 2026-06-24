"""
Configuration for Node 1.

Loads node1_intelligence/.env if present (no external dependency) and exposes
the optional-LLM settings as lazy getters so values are read at call time, not
import time. The taxonomy classifier needs none of this; it is all for the
opt-in LLM enrichment in llm.py.
"""

import os
from pathlib import Path

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


def llm_url() -> str:
    return os.getenv("NODE1_LLM_URL", "").strip()


def llm_key() -> str:
    return os.getenv("NODE1_LLM_KEY", "").strip()


def llm_model() -> str:
    return os.getenv("NODE1_LLM_MODEL", "gemma3:12b").strip()


def llm_no_think() -> bool:
    """Disable a reasoning model's hidden <think> phase for this simple task."""
    return os.getenv("NODE1_LLM_NO_THINK", "false").strip().lower() in {"1", "true", "yes"}


def llm_refine() -> bool:
    """Whether /analyze uses the LLM to refine titles. Off by default: title
    refinement is cosmetic and a slow reasoning model would block the pipeline.
    The copilot answer path uses the LLM regardless of this flag."""
    return os.getenv("NODE1_LLM_REFINE", "false").strip().lower() in {"1", "true", "yes"}


def llm_timeout() -> float:
    try:
        return float(os.getenv("NODE1_LLM_TIMEOUT", "60"))
    except ValueError:
        return 60.0
