"""
EventBus: asyncio fan-out pub/sub for the constellation UI.

Producers call bus.publish(event). Consumers (each WebSocket client)
subscribe() to get an asyncio.Queue that receives every event. Queues
are bounded so a slow client never blocks the pipeline.

Events are plain dicts so the WebSocket serializer can json.dumps them
directly.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)


def now_ms() -> float:
    """Wall-clock milliseconds for event timestamps."""
    return time.time() * 1000.0


def make_event(type_: str, **payload: Any) -> dict[str, Any]:
    """Canonical event envelope. Keep keys flat and json-safe."""
    return {"type": type_, "ts": now_ms(), **payload}


class EventBus:
    """
    Minimal broadcast bus. One producer, many consumers.

    The server calls attach_loop(loop) at startup so publish_sync() works
    from any thread, including the worker threads used by asyncio.to_thread
    (memory.store_turn lives there).
    """

    def __init__(self, maxsize: int = 512):
        self._subs: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()
        self._maxsize = maxsize
        self._loop: asyncio.AbstractEventLoop | None = None

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Register the main loop so sync callers can schedule events."""
        self._loop = loop

    async def publish(self, event: dict[str, Any]) -> None:
        async with self._lock:
            dead: list[asyncio.Queue] = []
            for q in self._subs:
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    # Drop oldest to keep UI fresh, then try again.
                    try:
                        q.get_nowait()
                        q.put_nowait(event)
                    except Exception:
                        dead.append(q)
            for q in dead:
                self._subs.discard(q)

    def publish_sync(self, event: dict[str, Any]) -> None:
        """
        Thread-safe publish used by sync code paths (tracer spans fire from
        inside swarm.run which may run in a worker thread).
        """
        loop = self._loop
        if loop is None:
            # Fall back to the currently-running loop if one exists in-thread.
            try:
                loop = asyncio.get_event_loop_policy().get_event_loop()
            except RuntimeError:
                return
        if not loop.is_running():
            return
        asyncio.run_coroutine_threadsafe(self.publish(event), loop)

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue]:
        q: asyncio.Queue = asyncio.Queue(maxsize=self._maxsize)
        async with self._lock:
            self._subs.add(q)
        try:
            yield q
        finally:
            async with self._lock:
                self._subs.discard(q)


# Process-wide singleton the server and tracer share.
BUS = EventBus()
