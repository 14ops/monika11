"""
Just Monika — CLI Entry Point

Simple terminal interface to chat with Monika.
Supports text mode (default) and voice mode (--voice).
Requires Ollama running locally with the configured models pulled.
"""

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from monika.agentic_age import AGENTIC_AGE_BRIEF, is_agentic_age_request
from monika.core.pipeline import MonikaPipeline
from monika.core.privacy import PrivacyLevel


async def async_main():
    parser = argparse.ArgumentParser(description="Just Monika — Anti-laziness AI companion")
    parser.add_argument("--ollama-url", default="http://localhost:11434/v1", help="Ollama API URL")
    parser.add_argument("--model", default="llama3.1:8b", help="Main LLM model for Monika")
    parser.add_argument("--aux-model", default="phi3:mini", help="Auxiliary model for classifiers")
    parser.add_argument("--voice", action="store_true", help="Enable voice mode (STT + TTS)")
    parser.add_argument("--stt-model", default="base", help="Whisper model size for STT")
    parser.add_argument("--tts-model", default=None, help="Path to Piper TTS model file")
    parser.add_argument("--max-context", type=int, default=4096, help="Max context window tokens")
    parser.add_argument(
        "--privacy", choices=["off", "memory_only", "strict"], default="memory_only",
        help="Privacy level: off, memory_only (default), strict",
    )
    parser.add_argument("--trace", action="store_true", help="Enable tracing (export to ~/.monika/traces/)")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    privacy_level = PrivacyLevel(args.privacy)

    pipeline = MonikaPipeline(
        ollama_url=args.ollama_url,
        persona_model=args.model,
        aux_model=args.aux_model,
        max_context=args.max_context,
        privacy_level=privacy_level,
        tracing=args.trace or args.verbose,
    )

    print("=" * 60)
    print("  Just Monika — Your anti-laziness AI companion")
    print("  I won't give you the answer. I will help you find it.")
    print("  Type 'quit' to exit.")
    if args.trace:
        print("  [Tracing enabled — traces saved to ~/.monika/traces/]")
    if privacy_level != PrivacyLevel.OFF:
        print(f"  [Privacy: {privacy_level.value}]")
    print("=" * 60)
    print()
    print(AGENTIC_AGE_BRIEF)
    print()

    try:
        if args.voice:
            await _voice_loop(pipeline, args)
        else:
            await _text_loop(pipeline, args)
    finally:
        # Export traces on exit if tracing is enabled
        if args.trace and pipeline.tracer.spans:
            trace_dir = Path.home() / ".monika" / "traces"
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            trace_path = trace_dir / f"session_{timestamp}.json"
            pipeline.tracer.export_json(trace_path)
            print(f"\n  [Trace exported: {trace_path}]")


async def _text_loop(pipeline: MonikaPipeline, args):
    """Standard text-based REPL."""
    while True:
        try:
            user_input = await asyncio.to_thread(input, "You > ")
            user_input = user_input.strip()
        except (EOFError, KeyboardInterrupt):
            print("\nSee you soon! Keep thinking for yourself. 💚")
            break

        if not user_input:
            continue
        if user_input.lower() in ("/agentic-age", "/marihacks-brief") or is_agentic_age_request(user_input):
            print(f"\nMonika >\n{AGENTIC_AGE_BRIEF}\n")
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            print("See you soon! Keep thinking for yourself. 💚")
            break

        response = await pipeline.arespond(user_input)
        print(f"\nMonika > {response.text}")

        stats = f"  [effort: {response.effort_score}/10 | emotion: {response.emotion}"
        if response.tokens_used > 0:
            stats += f" | tokens: {response.tokens_used}"
        if response.latency_ms > 0:
            stats += f" | {response.latency_ms:.0f}ms"
        stats += "]"
        print(stats)

        # Print detailed trace if verbose
        if args.verbose and pipeline.tracer.enabled:
            print(pipeline.tracer.format_summary())
        print()


async def _voice_loop(pipeline: MonikaPipeline, args):
    """Voice-based interaction loop."""
    try:
        from monika.voice import VOICE_AVAILABLE, VoicePipeline
    except ImportError:
        VOICE_AVAILABLE = False

    if not VOICE_AVAILABLE:
        print("Voice mode requires additional dependencies:")
        print("  pip install just-monika[voice]")
        sys.exit(1)

    voice = VoicePipeline(
        monika_pipeline=pipeline,
        stt_model=args.stt_model,
        tts_model_path=args.tts_model,
    )

    print("  [Voice mode active — speak, Monika listens]")
    print()

    while True:
        try:
            response = await voice.listen_and_respond()
            if response:
                print(f"\nMonika > {response.text}")
                print(f"  [effort: {response