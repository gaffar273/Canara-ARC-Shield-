"""
Local embedding, fully offline. Tries the sentence-transformers model first
(all-MiniLM-L6-v2, cached on disk — same model Node 2 uses), then an Ollama
endpoint if one is running. Any failure returns None so callers degrade to
keyword-only search instead of breaking the pipeline.
"""

import json
import logging
import os
import urllib.error
import urllib.request
from functools import lru_cache
from typing import List, Optional

logger = logging.getLogger("arc_vector.embeddings")

_ST_MODEL_NAME = os.getenv("ARC_ST_MODEL", "all-MiniLM-L6-v2")
_OLLAMA_URL = os.getenv("ARC_EMBED_URL", "http://localhost:11434/api/embeddings")
_MODEL = os.getenv("ARC_EMBED_MODEL", "nomic-embed-text")
_TIMEOUT = float(os.getenv("ARC_EMBED_TIMEOUT", "30"))

_st_model = None
_st_tried = False
# Circuit breaker: once the Ollama endpoint fails it stays off for this process,
# so a dead/absent Ollama costs one failed connection instead of one per clause.
_ollama_unavailable = False


def _sentence_transformer():
    """Lazy one-shot load of the local sentence-transformers model."""
    global _st_model, _st_tried
    if not _st_tried:
        _st_tried = True
        try:
            from sentence_transformers import SentenceTransformer

            _st_model = SentenceTransformer(_ST_MODEL_NAME)
            logger.info("sentence-transformers model '%s' loaded.", _ST_MODEL_NAME)
        except Exception as exc:
            logger.warning(
                "sentence-transformers unavailable (%s); will try the Ollama endpoint.", exc
            )
    return _st_model


def _embed_ollama(cleaned: str) -> Optional[List[float]]:
    global _ollama_unavailable
    if _ollama_unavailable:
        return None
    payload = json.dumps({"model": _MODEL, "prompt": cleaned}).encode("utf-8")
    req = urllib.request.Request(
        _OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            vector = json.loads(resp.read()).get("embedding")
        if isinstance(vector, list) and vector:
            return vector
        logger.warning("Embedding response had no vector; falling back to keyword search.")
        return None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        _ollama_unavailable = True
        logger.warning(
            "Ollama embedding endpoint unavailable (%s); using keyword-only search for the "
            "rest of this run (restart the node to re-probe).", exc,
        )
        return None


def embed(text: str) -> Optional[List[float]]:
    """Embed one piece of text. Returns the vector, or None if no model is
    available (so the caller can fall back to keyword search)."""
    cleaned = (text or "").strip()
    if not cleaned:
        return None
    model = _sentence_transformer()
    if model is not None:
        try:
            return [float(x) for x in model.encode(cleaned)]
        except Exception as exc:
            logger.warning("sentence-transformers embedding failed (%s); trying Ollama.", exc)
    return _embed_ollama(cleaned)


@lru_cache(maxsize=1)
def embedding_available() -> bool:
    """One-shot probe: is an embedding model reachable right now? Cached so a
    cold/absent model is not re-probed on every clause."""
    return embed("healthcheck") is not None
