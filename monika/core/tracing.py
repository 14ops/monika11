"""
Swarm Tracing — Lightweight observability for the Monika agent swarm.

Inspired by TraceAI's OpenTelemetry approach, but custom and minimal
for embedded deployment. Records structured spans for every LLM call,
tool execution, and agent handoff. Zero external dependencies.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


class SpanKind(str, Enum):
    LLM_CALL = "llm_call"
    TOOL_CALL = "tool_call"
    AGENT_HANDOFF = "agent_handoff"
    PIPELINE_RUN = "pipeline_run"


@dataclass
class Span:
    """A single traced operation in the swarm."""
    name: str
    kind: SpanKind
    agent_name: str = ""
    model: str = ""
    start_time: float = 0.0
    end_time: float = 0.0
    duration_ms: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def finish(self):
        """Record end time and compute duration."""
        self.end_time = time.monotonic()
        self.duration_ms = (self.end_time - self.start_time) * 1000

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


class Tracer:
    """
    Lightweight tracer for the Monika swarm.

    Records spans for LLM calls, tool executions, and agent handoffs.
    Provides session summaries and JSON export for debugging.
    """

    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self.spans: list[Span] = []
        self._active_spans: list[Span] = []
        self._lock = threading.Lock()

    def start_span(self, name: str, kind: SpanKind, **kwargs) -> Span:
        """Start a new span and return it."""
        span = Span(
            name=name,
            kind=kind,
            start_time=time.monotonic(),
            **kwargs,
        )
        if self.enabled:
            with self._lock:
                self._active_spans.append(span)
        return span

    def end_span(self, span: Span):
        """Finish a span and record it."""
        span.finish()
        if self.enabled:
            with self._lock:
                if span in self._active_spans:
                    self._active_spans.remove(span)
                self.spans.append(span)

    def summary(self) -> dict[str, Any]:
        """Generate a summary of all recorded spans."""
        if not self.spans:
            return {"total_spans": 0}

        total_tokens_in = sum(s.input_tokens for s in self.spans)
        total_tokens_out = sum(s.output_tokens for s in self.spans)
        total_duration = sum(s.duration_ms for s in self.spans)

        # Per-agent breakdown
        agents: dict[str, dict] = {}
        for span in self.spans:
            if not span.agent_name:
                continue
            if span.agent_name not in agents:
                agents[span.agent_name] = {
                    "calls": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "duration_ms": 0.0,
                    "errors": 0,
                }
            a = agents[span.agent_name]
            a["calls"] += 1
            a["input_tokens"] += span.input_tokens
            a["output_tokens"] += span.output_tokens
            a["duration_ms"] += span.duration_ms
            if span.error:
                a["errors"] += 1

        # Per-kind breakdown
        kinds: dict[str, int] = {}
        for span in self.spans:
            kinds[span.kind.value] = kinds.get(span.kind.value, 0) + 1

        return {
            "total_spans": len(self.spans),
            "total_input_tokens": total_tokens_in,
            "total_output_tokens": total_tokens_out,
            "total_tokens": total_tokens_in + total_tokens_out,
            "total_duration_ms": round(total_duration, 1),
            "span_kinds": kinds,
            "agents": agents,
        }

    def last_turn_summary(self, pipeline_span_name: str = "pipeline_run") -> dict[str, Any]:
        """Summary of only the most recent pipeline run."""
        # Find the last two PIPELINE_RUN spans to bracket the most recent run.
        # Child spans (llm calls, tool calls) are end_span'd before the pipeline
        # span, so they appear *before* it in self.spans. We need to find the
        # second-to-last pipeline span (or start of list) as the lower bound.
        pipeline_indices = [
            i for i, s in enumerate(self.spans) if s.kind == SpanKind.PIPELINE_RUN
        ]

        if not pipeline_indices:
            return self.summary()

        if len(pipeline_indices) >= 2:
            # Everything after the previous pipeline run's span
            start = pipeline_indices[-2] + 1
        else:
            start = 0

        recent = self.spans[start:]
        tracer = Tracer(enabled=False)
        tracer.spans = recent
        return tracer.summary()

    def format_summary(self, summary: dict | None = None) -> str:
        """Format a summary dict as a human-readable string."""
        s = summary or self.last_turn_summary()
        if s.get("total_spans", 0) == 0:
            return "  [no spans recorded]"

        lines = [
            f"  tokens: {s.get('total_tokens', 0)} "
            f"(in:{s.get('total_input_tokens', 0)} out:{s.get('total_output_tokens', 0)}) | "
            f"latency: {s.get('total_duration_ms', 0):.0f}ms",
        ]
        agents = s.get("agents", {})
        if agents:
            for name, info in agents.items():
                lines.append(
                    f"    {name}: {info['input_tokens']+info['output_tokens']} tokens, "
                    f"{info['duration_ms']:.0f}ms, {info['calls']} calls"
                )
        return "\n".join(lines)

    def export_json(self, path: str | Path):
        """Export all spans to a JSON file."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "summary": self.summary(),
            "spans": [
                {
                    "name": s.name,
                    "kind": s.kind.value,
                    "agent_name": s.agent_name,
                    "model": s.model,
                    "duration_ms": round(s.duration_ms, 2),
                    "input_tokens": s.input_tokens,
                    "output_tokens": s.output_tokens,
                    "metadata": s.metadata,
                    "error": s.error,
                }
                for s in self.spans
            ],
        }
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False))

    def clear(self):
        """Clear all recorded spans."""
        with self._lock:
            self.spans.clear()
            self._active_spans.clear()
