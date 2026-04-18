"""
MariHacks server: FastAPI + WebSocket over the Monika pipeline.

Routes:
  GET  /status           health and memory counts
  GET  /ws               live event stream for the Obsidian constellation view
  POST /chat             { "message": str } -> { "text", "effort_score", "emotion", ... }
  POST /vault/reindex    force a full vault reindex, returns chunk count
  POST /vault/path       { "path": str } to set the watched vault path at runtime

Run:
  uvicorn marihacks.server:app --host 127.0.0.1 --port 8787

Env vars:
  MONIKA_OLLAMA_URL      default http://localhost:11434/v1
  MONIKA_MODEL           default llama3.1:8b
  MONIKA_AUX_MODEL       default phi3:mini
  MONIKA_VAULT_PATH      if set, indexed and watched at startup
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from monika.agentic_age import AGENTIC_AGE_BRIEF, is_agentic_age_request
from monika.core.pipeline import MonikaPipeline
from monika.core.privacy import PrivacyLevel

from marihacks.event_tracer import EventEmittingTracer
from marihacks.events import BUS, make_event
from marihacks.vault import VaultIndexer

logger = logging.getLogger(__name__)


# --- Config ------------------------------------------------------------------

OLLAMA_URL = os.environ.get("MONIKA_OLLAMA_URL", "http://localhost:11434/v1")
PERSONA_MODEL = os.environ.get("MONIKA_MODEL", "llama3.1:8b")
AUX_MODEL = os.environ.get("MONIKA_AUX_MODEL", "phi3:mini")
VAULT_PATH = os.environ.get("MONIKA_VAULT_PATH")


# --- App state ---------------------------------------------------------------


class AppState:
    pipeline: MonikaPipeline | None = None
    indexer: VaultIndexer | None = None
    watcher_thread: threading.Thread | None = None


STATE = AppState()


def build_pipeline() -> MonikaPipeline:
    """Build the pipeline and swap in the event-emitting tracer."""
    p = MonikaPipeline(
        ollama_url=OLLAMA_URL,
        persona_model=PERSONA_MODEL,
        aux_model=AUX_MODEL,
        privacy_level=PrivacyLevel.MEMORY_ONLY,
        tracing=True,
    )
    event_tracer = EventEmittingTracer(bus=BUS, enabled=True)
    p.tracer = event_tracer
    p.swarm.tracer = event_tracer
    p.async_swarm.tracer = event_tracer
    return p


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # Hand the event bus the running loop so sync producers (tracer, watchdog)
    # will publish into it from any thread.
    BUS.attach_loop(asyncio.get_running_loop())
    STATE.pipeline = build_pipeline()
    if VAULT_PATH:
        await _start_vault(VAULT_PATH)
    yield
    if STATE.indexer and STATE.indexer._observer:
        STATE.indexer._observer.stop()


app = FastAPI(title="MariHacks Monika Server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Models ------------------------------------------------------------------


class ChatIn(BaseModel):
    message: str


class VaultPathIn(BaseModel):
    path: str


# --- Helpers -----------------------------------------------------------------


async def _start_vault(path: str) -> dict[str, Any]:
    if not STATE.pipeline or not STATE.pipeline.memory or not STATE.pipeline.memory.enabled:
        raise HTTPException(503, "memory unavailable, install chromadb and restart")
    indexer = VaultIndexer(path, STATE.pipeline.memory)
    chunks = await asyncio.to_thread(indexer.full_reindex)
    STATE.indexer = indexer
    # Start watchdog in a daemon thread so the API stays responsive.
    t = threading.Thread(target=indexer.watch, daemon=True, name="vault-watcher")
    t.start()
    STATE.watcher_thread = t
    return {"path": str(indexer.vault_path), "chunks": chunks}


async def _publish_memory_hits(message: str) -> None:
    """Emit memory_hit events before the pipeline runs so the UI lights up."""
    mem = STATE.pipeline.memory if STATE.pipeline else None
    if not mem or not getattr(mem, "enabled", False):
        return
    try:
        hits = await asyncio.to_thread(mem.search_with_meta, message, 5)
    except Exception as e:
        logger.warning("memory search failed: %s", e)
        return
    for h in hits:
        await BUS.publish(
            make_event(
                "memory_hit",
                id=h.id,
                title=h.title,
                source=h.source,
                distance=round(h.distance, 4),
                path=h.metadata.get("path", ""),
                heading=h.metadata.get("heading", ""),
                preview=h.text[:200],
            )
        )


# --- Routes ------------------------------------------------------------------


@app.get("/status")
async def status() -> dict[str, Any]:
    mem = STATE.pipeline.memory if STATE.pipeline else None
    return {
        "ok": True,
        "ollama_url": OLLAMA_URL,
        "persona_model": PERSONA_MODEL,
        "aux_model": AUX_MODEL,
        "memory_enabled": bool(mem and getattr(mem, "enabled", False)),
        "memory_counts": mem.counts() if (mem and hasattr(mem, "counts")) else {},
        "vault_path": str(STATE.indexer.vault_path) if STATE.indexer else None,
    }


@app.get("/agentic-age")
async def agentic_age() -> dict[str, str]:
    return {"title": "The Agentic Age", "text": AGENTIC_AGE_BRIEF}


@app.post("/chat")
async def chat(body: ChatIn) -> dict[str, Any]:
    if not STATE.pipeline:
        raise HTTPException(503, "pipeline not ready")
    if not body.message.strip():
        raise HTTPException(400, "empty message")

    if is_agentic_age_request(body.message):
        await BUS.publish(make_event("user_message", text=body.message))
        await BUS.publish(make_event("pipeline_start"))
        await BUS.publish(
            make_event(
                "assistant_message",
                text=AGENTIC_AGE_BRIEF,
                effort_score=10,
                emotion="curious",
                emotion_confidence=1.0,
            )
        )
        await BUS.publish(make_event("pipeline_end"))
        return {
            "text": AGENTIC_AGE_BRIEF,
            "effort_score": 10,
            "emotion": "curious",
            "emotion_confidence": 1.0,
            "tokens_used": 0,
            "latency_ms": 0.0,
        }

    await BUS.publish(make_event("user_message", text=body.message))
    await BUS.publish(make_event("pipeline_start"))
    await _publish_memory_hits(body.message)

    try:
        resp = await STATE.pipeline.arespond(body.message)
    except Exception as e:
        logger.exception("pipeline error")
        await BUS.publish(make_event("pipeline_error", error=str(e)))
        raise HTTPException(500, f"pipeline error: {e}") from e

    await BUS.publish(
        make_event(
            "assistant_message",
            text=resp.text,
            effort_score=resp.effort_score,
            emotion=resp.emotion,
            emotion_confidence=resp.emotion_confidence,
        )
    )
    await BUS.publish(make_ev