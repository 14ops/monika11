"""
Standalone smoke test. No Ollama, no FastAPI, no Obsidian required.

What it checks:
  1. EventBus fan-out: two subscribers, both receive published events
  2. Sync publish from a worker thread (simulates watchdog + tracer)
  3. EventEmittingTracer wraps Tracer and emits agent_start/agent_complete
  4. Span kinds map to the right event types (handoff, tool_call, agent_*)

Run:
  python -m marihacks.smoke_test

Expected exit code: 0, with a checklist of PASS lines at the end.
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

from monika.core.tracing import SpanKind

from marihacks.event_tracer import EventEmittingTracer
from marihacks.events import BUS, make_event


async def _subscriber(name: str, received: list[dict[str, Any]], stop: asyncio.Event) -> None:
    async with BUS.subscribe() as q:
        while not stop.is_set():
            try:
                ev = await asyncio.wait_for(q.get(), timeout=0.25)
            except asyncio.TimeoutError:
                continue
            received.append(ev)


async def main() -> int:
    BUS.attach_loop(asyncio.get_running_loop())
    results_a: list[dict[str, Any]] = []
    results_b: list[dict[str, Any]] = []
    stop = asyncio.Event()

    sub_a = asyncio.create_task(_subscriber("a", results_a, stop))
    sub_b = asyncio.create_task(_subscriber("b", results_b, stop))

    # Give subscribers a tick to install.
    await asyncio.sleep(0.05)

    # --- Test 1: direct async publish reaches both subscribers ---
    await BUS.publish(make_event("user_message", text="hello"))

    # --- Test 2: sync publish from a worker thread reaches both ---
    def worker() -> None:
        BUS.publish_sync(make_event("vault_upsert", path="notes/Recursion.md", chunks=4))

    threading.Thread(target=worker, daemon=True).start()

    # --- Test 3: tracer emits structured events for spans ---
    tracer = EventEmittingTracer(enabled=True)
    span_a = tracer.start_span("llm:reasoning_validator", SpanKind.LLM_CALL, agent_name="reasoning_validator", model="phi3:mini")
    span_a.input_tokens = 42
    span_a.output_tokens = 17
    tracer.end_span(span_a)

    span_b = tracer.start_span("tool:memory_search", SpanKind.TOOL_CALL, agent_name="monika_persona", metadata={"function": "memory_search", "arguments": '{"query":"recursion"}'})
    tracer.end_span(span_b)

    span_c = tracer.start_span("handoff:reasoning_validator->monika_persona", SpanKind.AGENT_HANDOFF, agent_name="reasoning_validator", metadata={"target_agent": "monika_persona"})
    tracer.end_span(span_c)

    # Let scheduled publishes drain.
    await asyncio.sleep(0.2)
    stop.set()
    await asyncio.gather(sub_a, sub_b, return_exceptions=True)

    # --- Assertions ---
    checks: list[tuple[str, bool, str]] = []

    def count(events: list[dict[str, Any]], type_: str) -> int:
        return sum(1 for e in events if e.get("type") == type_)

    # fan-out: both subscribers received the same number of events
    checks.append((
        "fan-out delivers to all subscribers",
        len(results_a) == len(results_b) and len(results_a) > 0,
        f"a={len(results_a)} b={len(results_b)}",
    ))
    # user_message landed
    checks.append((
        "async publish delivers user_message",
        count(results_a, "user_message") == 1,
        f"user_message={count(results_a, 'user_message')}",
    ))
    # vault_upsert from worker thread landed
    checks.append((
        "sync publish from worker thread delivers",
        count(results_a, "vault_upsert") == 1,
        f"vault_upsert={count(results_a, 'vault_upsert')}",
    ))
    # tracer start + end for LLM call
    checks.append((
        "tracer emits agent_start for LLM span",
        any(e["type"] == "agent_start" and e.get("agent") == "reasoning_validator" for e in results_a),
        "",
    ))
    checks.append((
        "tracer emits agent_complete with tokens",
        any(e["type"] == "agent_complete" and e.get("input_tokens") == 42 and e.get("output_tokens") == 17 for e in results_a),
        "",
    ))
    # tool_call event
    checks.append((
        "tracer emits tool_call for TOOL span",
        any(e["type"] == "tool_call" and e.get("name") == "memory_search" for e in results_a),
        "",
    ))
    # handoff event
    checks.append((
        "tracer emits handoff for AGENT_HANDOFF span",
        any(e["type"] == "handoff" and e.get("from") == "reasoning_validator" and e.get("to") == "monika_persona" for e in results_a),
        "",
    ))

    ok = True
    print()
    print("Event stream sample (subscriber A):")
    for e in results_a:
        preview = {k: v for k, v in e.items() if k not in ("ts",)}
        print(f"  {preview}")
    print()
    for name, passed, detail in checks:
        marker = "PASS" if passed else "FAIL"
        ok = ok and passed
        extra = f"  ({detail})" if detail else ""
        print(f"  [{marker}] {name}{extra}")

    print()
    print("overall:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
