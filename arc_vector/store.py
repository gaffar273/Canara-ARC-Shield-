"""
Persistent hybrid vector store over ChromaDB.

A thin wrapper that keeps one cosine-space ChromaDB collection on disk and serves
Hybrid Search: semantic similarity from the embedding model blended with keyword
overlap. The blend means an exact regulatory term (a circular number, "LCR",
"MFA") still ranks even when the embedding is lukewarm, while paraphrases that
share no keywords are still caught semantically.

Falls back cleanly: if embeddings are unavailable the store ranks by keyword
overlap alone, so retrieval still works (just without the semantic half).
"""

import logging
import os
import re
from dataclasses import dataclass
from typing import Dict, List, Optional

import chromadb

from arc_vector.embeddings import embed, embedding_available

logger = logging.getLogger("arc_vector.store")

_BASE_DIR = os.getenv(
    "ARC_VECTOR_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".chroma"),
)

# Weighting of the two retrieval signals. Semantic carries most of the decision;
# keyword overlap is a tie-breaker that rescues exact-term matches.
_SEMANTIC_WEIGHT = 0.7
_KEYWORD_WEIGHT = 0.3
# Fallback dimension for placeholder vectors when the embedding model is down.
# Must match the embedding model's output dim (nomic-embed-text = 768) so a
# document stored during an outage doesn't clash with real vectors later.
_EMBED_DIM = int(os.getenv("ARC_EMBED_DIM", "768"))
_STOPWORDS = {
    "the", "and", "for", "this", "that", "with", "shall", "have", "been", "from",
    "under", "into", "such", "any", "all", "are", "may", "will", "which", "these",
}


def _keywords(text: str) -> set:
    return {
        w
        for w in re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).split()
        if len(w) >= 4 and w not in _STOPWORDS
    }


def _keyword_overlap(a: str, b: str) -> float:
    ka, kb = _keywords(a), _keywords(b)
    if not ka or not kb:
        return 0.0
    return len(ka & kb) / len(ka | kb)


@dataclass
class HybridHit:
    id: str
    document: str
    metadata: Dict
    semantic: float
    keyword: float
    score: float


class HybridVectorStore:
    """One persistent ChromaDB collection plus hybrid ranking.

    `name` must be 3-512 chars of [a-zA-Z0-9._-]; it also names the on-disk
    directory, so two processes using different names never share a SQLite file.
    """

    def __init__(self, name: str):
        self.name = name
        path = os.path.join(_BASE_DIR, name)
        os.makedirs(path, exist_ok=True)
        self._client = chromadb.PersistentClient(path=path)
        # embedding_function=None: we always supply embeddings ourselves (real or
        # a placeholder). Without this, an upsert that omits embeddings makes
        # Chroma silently apply its built-in 384-dim model, which then clashes
        # with our 768-dim nomic vectors ("expecting dimension 768, got 384").
        self._collection = self._client.get_or_create_collection(
            name, metadata={"hnsw:space": "cosine"}, embedding_function=None
        )

    def upsert(self, doc_id: str, text: str, metadata: Optional[Dict] = None) -> None:
        """Add or update one document. No-op on empty text. If the embedding model
        is unavailable the document is stored with a zero placeholder vector so it
        stays retrievable by the keyword half of the hybrid search and the
        collection's dimension never clashes with real vectors."""
        cleaned = (text or "").strip()
        if not cleaned:
            return
        meta = {**(metadata or {}), "_text": cleaned}
        vector = embed(cleaned)
        if vector is None:
            meta["_no_embedding"] = True
            vector = [0.0] * _EMBED_DIM
        self._collection.upsert(ids=[doc_id], embeddings=[vector], documents=[cleaned], metadatas=[meta])

    def count(self) -> int:
        return self._collection.count()

    def search(self, text: str, top_k: int = 25, exclude_id: Optional[str] = None) -> List[HybridHit]:
        """Hybrid Search: pull the top_k nearest by vector, then re-rank by a
        weighted blend of semantic similarity and keyword overlap. Returns hits
        sorted best-first. The caller decides the acceptance threshold."""
        cleaned = (text or "").strip()
        if not cleaned or self._collection.count() == 0:
            return []

        vector = embed(cleaned)
        n = min(top_k, self._collection.count())

        if vector is not None:
            res = self._collection.query(
                query_embeddings=[vector],
                n_results=n,
                include=["documents", "metadatas", "distances"],
            )
            ids = res["ids"][0]
            docs = res["documents"][0]
            metas = res["metadatas"][0]
            dists = res["distances"][0]
            semantic_scores = [max(0.0, 1.0 - d) for d in dists]  # cosine distance -> similarity
        else:
            # Keyword-only fallback: scan the collection (small KB; fine offline).
            got = self._collection.get(include=["documents", "metadatas"])
            ids = got["ids"]
            docs = got["documents"]
            metas = got["metadatas"]
            semantic_scores = [0.0] * len(ids)

        hits: List[HybridHit] = []
        for doc_id, doc, meta, sem in zip(ids, docs, metas, semantic_scores):
            if exclude_id is not None and doc_id == exclude_id:
                continue
            kw = _keyword_overlap(cleaned, doc or (meta or {}).get("_text", ""))
            score = _SEMANTIC_WEIGHT * sem + _KEYWORD_WEIGHT * kw if vector is not None else kw
            hits.append(
                HybridHit(id=doc_id, document=doc, metadata=meta or {}, semantic=round(sem, 4),
                          keyword=round(kw, 4), score=round(score, 4))
            )
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:top_k]

    def best(self, text: str, threshold: float = 0.0, top_k: int = 25,
             exclude_id: Optional[str] = None) -> Optional[HybridHit]:
        """Single best hit at or above `threshold`, or None."""
        hits = self.search(text, top_k=top_k, exclude_id=exclude_id)
        if hits and hits[0].score >= threshold:
            return hits[0]
        return None
