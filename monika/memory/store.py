"""
Memory Manager — Local RAG-based long-term memory for Monika.

Uses ChromaDB for vector storage and Ollama's embedding endpoint
for local embeddings. ChromaDB is optional. If not installed, the
memory manager gracefully degrades to a no-op.

Three logical collections live behind one surface:
  - conversation_facts: user/assistant fact extractions
  - topics:             topic-level summaries
  - notes:              Obsidian vault chunks indexed by the watcher
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from monika.core.swarm import Agent, MonikaSwarm

logger = logging.getLogger(__name__)

# Default persist path for memory database
DEFAULT_MEMORY_PATH = Path.home() / ".monika" / "memory"

FACT_EXTRACTOR_INSTRUCTIONS = """Tu es un extracteur de faits silencieux. Tu ne parles JAMAIS à l'utilisateur.

## Ta mission
Extraire les faits importants d'un échange entre un utilisateur et Monika.

## Ce que tu extrais
- Préférences de l'utilisateur (langage de programmation, sujets d'intérêt, etc.)
- Ce sur quoi l'utilisateur travaille
- Les difficultés rencontrées
- Les progrès réalisés
- Les compétences démontrées ou manquantes

## Format de réponse OBLIGATOIRE
Tu dois TOUJOURS répondre en JSON valide — un tableau de strings, rien d'autre :
["fait 1", "fait 2", "fait 3"]

Si aucun fait important, retourne : []
"""


@dataclass
class MemoryHit:
    """Retrieval result with metadata, used by the constellation UI."""
    id: str
    text: str
    title: str
    source: str  # "note" | "fact" | "topic"
    distance: float
    metadata: dict[str, Any]


class OllamaEmbeddingFunction:
    """ChromaDB-compatible embedding function using Ollama's local endpoint."""

    def __init__(self, ollama_url: str = "http://localhost:11434/v1", model: str = "nomic-embed-text"):
        from openai import OpenAI

        self.client = OpenAI(base_url=ollama_url, api_key="local")
        self.model = model
        self.ollama_url = ollama_url

    def __call__(self, input: list[str]) -> list[list[float]]:
        """Embed a list of texts using Ollama."""
        response = self.client.embeddings.create(model=self.model, input=input)
        return [item.embedding for item in response.data]

    def embed_documents(self, input=None, **kwargs) -> list[list[float]]:
        """ChromaDB >=0.6 calls this for document embeddings."""
        texts = input if input is not None else kwargs.get("texts", [])
        if isinstance(texts, str):
            texts = [texts]
        return self.__call__(texts)

    def embed_query(self, input=None, **kwargs) -> list[list[float]]:
        """ChromaDB 1.x expects a list of embeddings back. Wrap a single query."""
        text = input if input is not None else kwargs.get("text", "")
        if isinstance(text, list):
            return self.__call__(text)
        return self.__call__([text])

    @staticmethod
    def name() -> str:
        """ChromaDB >=0.5 requires embedding functions to be named."""
        return "ollama_openai"

    def get_config(self) -> dict:
        """Return serializable config for ChromaDB persistence."""
        return {"ollama_url": self.ollama_url, "model": self.model}

    @classmethod
    def build_from_config(cls, config: dict) -> "OllamaEmbeddingFunction":
        return cls(ollama_url=config.get("ollama_url", "http://localhost:11434/v1"), model=config.get("model", "nomic-embed-text"))

    def default_space(self) -> str:
        return "cosine"

    def supported_spaces(self) -> list[str]:
        return ["cosine", "l2", "ip"]

    def is_legacy(self) -> bool:
        return False


class MemoryManager:
    """
    Manages Monika's long-term memory using local ChromaDB + Ollama embeddings.

    If ChromaDB is not installed, all methods gracefully return empty results.
    """

    def __init__(
        self,
        ollama_url: str = "http://localhost:11434/v1",
        embedding_model: str = "nomic-embed-text",
        persist_path: Path | None = None,
        aux_model: str = "phi3:mini",
    ):
        self._enabled = False
        self._turn_counter = 0

        try:
            import chromadb

            path = persist_path or DEFAULT_MEMORY_PATH
            path.mkdir(parents=True, exist_ok=True)

            embed_fn = OllamaEmbeddingFunction(ollama_url=ollama_url, model=embedding_model)
            self._client = chromadb.PersistentClient(path=str(path))
            self._facts = self._client.get_or_create_collection(
                name="conversation_facts",
                embedding_function=embed_fn,
            )
            self._topics = self._client.get_or_create_collection(
                name="topics",
                embedding_function=embed_fn,
            )
            self._notes = self._client.get_or_create_collection(
                name="notes",
                embedding_function=embed_fn,
                metadata={"hnsw:space": "cosine"},
            )
            self._enabled = True
            logger.info("Memory manager initialized at %s", path)
        except ImportError:
            logger.info("ChromaDB not installed — memory manager disabled")
        except Exception as e:
            logger.warning("Memory manager initialization failed: %s", e)

        # Fact extractor agent (used by store_turn)
        self._fact_extractor = Agent(
            name="fact_extractor",
            model=aux_model,
            instructions=FACT_EXTRACTOR_INSTRUCTIONS,
        )

    @property
    def enabled(self) -> bool:
        return self._enabled

    def search(self, query: str, n_results: int = 3) -> list[str]:
        """Search memory for facts relevant to the query."""
        if not self._enabled:
            return []
        try:
            results = self._facts.query(query_texts=[query], n_results=n_results)
            documents = results.get("documents", [[]])[0]
            return [doc for doc in documents if doc]
        except Exception as e:
            logger.warning("Memory search failed: %s", e)
            return []

    def store_facts(self, facts: list[str]) -> None:
        """Store a list of facts directly into memory."""
        if not self._enabled or not facts:
            return
        try:
            now = datetime.now(timezone.utc).isoformat()
            self._turn_counter += 1
            ids = [f"turn{self._turn_counter}_fact{i}" for i in range(len(facts))]
            metadatas = [
                {"turn": self._turn_counter, "timestamp": now, "type": "fact"}
                for _ in facts
            ]
            self._facts.add(documents=facts, ids=ids, metadatas=metadatas)
            logger.debug("Stored %d facts in memory", len(facts))
        except Exception as e:
            logger.warning("Failed to store facts: %s", e)

    def store_turn(self, user_message: str, assistant_response: str, swarm: MonikaSwarm) -> None:
        """Extract facts from a conversation turn and store them."""
        if not self._enabled:
            return

        # Step 1: Extract facts via LLM
        raw_response = ""
        try:
            prompt = (
                f"Échange à analyser :\n"
                f"Utilisateur : {user_message}\n"
                f"Monika : {assistant_response}\n\n"
                f"Extrais les faits importants."
            )
            result = swarm.run(
                self._fact_extractor,
                [{"role": "user", "content": prompt}],
                max_turns=1,
            )
            raw_response = result.final_response
        except Exception as e:
            logger.warning("Fact extraction LLM call failed: %s", e)
            return

        # Step 2: Parse the extracted facts
        try:
            facts = json.loads(raw_response)
            if not isinstance(facts, list):
                logger.warning("Fact extractor returned non-list: %s", type(facts).__name__)
                return
            valid_facts = [f for f in facts if isinstance(f, str) and f.strip()]
        except json.JSONDecodeError:
            logger.warning("Fact extractor returned invalid JSON: %.100s", raw_response)
            return

        # Step 3: Store the parsed facts
        if valid_facts:
            self.store_facts(valid_facts)

    def get_topic_summary(self, query: str, n_results: int = 2) -> list[str]:
        """Search topic-level summaries."""
        if not self._enabled:
            return []
        try:
            results = self._topics.query(query_texts=[query], n_results=n_results)
            return results.get("documents", [[]])[0]
        except Exception as e:
            logger.warning("Topic search failed: %s", e)
            return []

    def store_topic(self, topic: str, topic_id: str | None = None) -> None:
        """Store or update a topic summary."""
        if not self._enabled:
            return
        try:
            now = datetime.now(timezone.utc).isoformat()
            tid = topic_id or f"topic_{hash(topic) % 100000}"
            self._topics.upsert(
                documents=[topic],
                ids=[tid],
                metadatas=[{"last_seen": now}],
            )
        except Exception as e:
            logger.warning("Failed to store topic: %s", e)

    # --- Vault/notes API (used by the Obsidian watcher) ------------------

    def upsert_note(
        self,
        note_id: str,
        title: str,
        text: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Upsert one vault chunk into the notes collection."""
        if not self._enabled:
            return
        meta: dict[str, Any] = {"title": title, "kind": "note"}
        if metadata:
            for k, v in metadata.items():
                if isinstance(v, (str, int, float, bool)):
                    meta[k] = v
        try:
            self._notes.upsert(ids=[note_id], documents=[text], metadatas=[meta])
        except Exception as e:
            logger.warning("upsert_note failed for %s: %s", note_id, e)

    def delete_note(self, note_id: str) -> None:
        if not self._enabled:
            return
        try:
            self._notes.delete(ids=[note_id])
        except Exception as e:
            logger.warning("delete_note failed for %s: %s", note_id, e)

    def delete_notes_for_path(self, path: str) -> None:
        """Drop every chunk matching metadata.path. Used on file delete or rename."""
        if not self._enabled:
            return
        try:
            self._notes.delete(where={"path": path})
        except Exception as e:
            logger.warning("delete_notes_for_path failed for %s: %s", path, e)

    def search_with_meta(self, query: str, n_results: int = 3) -> list[MemoryHit]:
        """Merged search across notes and facts, typed for the constellation UI."""
        if not self._enabled:
            return []
        merged: list[MemoryHit] = []
        for coll, source in ((self._notes, "note"), (self._facts, "fact")):
            try:
                res = coll.query(query_texts=[query], n_results=n_results)
            except Exception as e:
                logger.warning("search_with_meta failed on %s: %s", source, e)
                continue
            ids = (res.get("ids") or [[]])[0] or []
            docs = (res.get("documents") or [[]])[0] or []
            metas = (res.get("metadatas") or [[]])[0] or [{}] * len(ids)
            dists = (res.get("distances") or [[]])[0] or [0.0] * len(ids)
            for i, doc, meta, dist in zip(ids, docs, metas, dists):
                meta = meta or {}
                merged.append(
                    MemoryHit(
                        id=i,
                        text=doc or "",
                        title=str(meta.get("title", i)),
                        source=source,
                        distance=float(dist),
                        metadata=dict(meta),
                    )
                )
        merged.sort(key=lambda h: h.distance)
        return merged[:n_results]

    def counts(self) -> dict[str, int]:
        """Diagnostic counts exposed on the status endpoint."""
        if not self._enabled:
            return {"facts": 0, "topics": 0, "notes": 0}
        try:
            return {
                "facts": self._facts.count(),
                "topics": self._topics.count(),
                "notes": self._notes.count(),
            }
        except Exception:
            return {"facts": 0, "topics": 0, "notes": 0}
