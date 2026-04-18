"""
EventEmittingTracer: hooks the existing Tracer so every span also
broadcasts a live event on the EventBus.

Event types emitted:
  agent_start      name, agent, model, kind
  agent_complete   name, agent, kind, duration_ms, input_tokens, output_tokens, error
  handoff          from, to
  tool_call        name, agent, args_preview, duration_ms
  pipeline_start   (synthetic, fired by the server before dispatching)
  pipeline_end     (synthetic, fired by the server after the persona responds)
  memory_hit       id, title, source, distance   (fired by vault indexer + pipeline)
  user_message     text
  assistant_chunk  text, final
"""

from __future__ import annotations

import logging
from typing import Any

from monika.core.tracing import Span, SpanKind, Tracer

from marihacks.events import BUS, EventBus, make_event

logger = logging.getLogger(__name__)


class EventEmittingTracer(Tracer):
    """Tracer subclass that broadcasts every span life-cycle event."""

    def __init__(self, bus: EventBus | None = None, enabled: bool = True):
        super().__init__(enabled=enabled)
        self._bus = bus or BUS

    def start_span(self, name: str, kind: SpanKind, **kwargs: Any) -> Span:
        span = super().start_span(name, kind, **kwargs)
        if self.enabled:
            payload = {
                "name": name,
                "agent": span.agent_name,
                "model": span.model,
                "kind": kind.value,
            }
            # Emit a dedicated handoff event for the constellation arc renderer.
            if kind is SpanKind.AGENT_HANDOFF:
                meta = span.metadata or {}
                payload["from"] = span.agent_name
                payload["to"] = str(meta.get("target_agent", ""))
                self._bus.publish_sync(make_event("handoff", **payload))
            else:
                self._bus.publish_sync(make_event("agent_start", **payload))
        return span

    def end_span(self, span: Span) -> None:
        super().end_span(span)
        if not self.enabled:
            return
        payload = {
            "name": span.name,
            "agent": span.agent_name,
            "kind": span.kind.value,
            "duration_ms": round(span.duration_ms, 1),
            "input_tokens": span.input_tokens,
            "output_tokens": span.output_tokens,
            "error": span.error,
        }
        if span.kind is SpanKind.TOOL_CALL:
            meta = span.metadata or {}
            args_preview = str(meta.get("arguments", ""))[:120]
            self._bus.publish_sync(
                make_event(
                    "tool_call",
                    name=str(meta.get("function", span.name)),
                    agent=span.agent_name,
                    args_preview=args_preview,
                    duration_ms=payload["duration_ms"],
                    error=span.error,
                )
            )
        else:
            self._bus.publish_sync(make_event("agent_complete", **payload))
