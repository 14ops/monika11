"""
Monika Pipeline — Orchestrates the full agent swarm.

Flow: User message → [Emotion + Reasoning in parallel] → Memory → Monika Persona → Response

Features:
- Sync (respond) and async (arespond) execution
- Tracing: structured spans for every LLM call, tool call, agent handoff
- Context budget: auto-compresses history when approaching model context limit
- Privacy shield: redacts PII before storing to memory/traces
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass

from monika.agents.emotion import create_emotion_classifier
from monika.agents.persona import create_monika_agent
from monika.agents.reasoning import create_reasoning_validator
from monika.core.context import ContextBudget
from monika.core.privacy import PrivacyLevel, PrivacyShield
from monika.core.swarm import AsyncMonikaSwarm, MonikaSwarm
from monika.core.tracing import SpanKind, Tracer

logger = logging.getLogger(__name__)


@dataclass
class MonikaResponse:
    """Full response from the Monika pipeline."""
    text: str
    effort_score: int
    emotion: str
    emotion_confidence: float
    tokens_used: int = 0
    latency_ms: float = 0.0


class MonikaPipeline:
    """
    Full pipeline that runs all agents to produce a Monika response.

    1. Emotion Classifier analyzes user emotion
    2. Reasoning Validator scores user effort
    3. Memory Manager retrieves relevant context
    4. Context Budget compresses history if needed
    5. Monika Persona generates response with full context
    6. Memory Manager stores facts from the exchange
    """

    def __init__(
        self,
        ollama_url: str = "http://localhost:11434/v1",
        persona_model: str = "llama3.1:8b",
        aux_model: str = "phi3:mini",
        max_context: int = 4096,
        privacy_level: PrivacyLevel = PrivacyLevel.MEMORY_ONLY,
        tracing: bool = False,
    ):
        # Tracing
        self.tracer = Tracer(enabled=tracing)

        # Swarms (share the same tracer)
        self.swarm = MonikaSwarm(base_url=ollama_url, tracer=self.tracer)
        self.async_swarm = AsyncMonikaSwarm(base_url=ollama_url, tracer=self.tracer)

        # Agents
        self.persona = create_monika_agent(model=persona_model)
        self.reasoning = create_reasoning_validator(model=aux_model)
        self.emotion = create_emotion_classifier(model=aux_model)
        self.conversation_history: list[dict] = []

        # Context budget
        self.context_budget = ContextBudget(max_tokens=max_context)

        # Privacy shield
        self.privacy = PrivacyShield(level=privacy_level)

        # Memory manager (optional — gracefully disabled if ChromaDB not installed)
        self.memory = None
        try:
            from monika.memory.store import MemoryManager
            self.memory = MemoryManager(ollama_url=ollama_url, aux_model=aux_model)
            if self.memory.enabled:
                self._register_memory_tool()
        except ImportError:
            logger.info("Memory module not available — running without long-term memory")

    def _register_memory_tool(self):
        """Register the memory_search tool on the persona agent."""
        memory = self.memory

        def memory_search(query: str) -> str:
            results = memory.search(query, n_results=3)
            return "\n".join(results) if results else "Aucun souvenir pertinent."

        self.persona.register_tool(
            func=memory_search,
            description="Chercher dans la mémoire long-terme de Monika pour retrouver des faits sur l'utilisateur.",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Ce qu'on cherche dans la mémoire"},
                },
                "required": ["query"],
            },
        )

    # ── Sync API ──────────────────────────────────────────────────

    def respond(self, user_message: str) -> MonikaResponse:
        """Process a user message through the full Monika pipeline (sync)."""
        pipeline_span = self.tracer.start_span("pipeline_run", SpanKind.PIPELINE_RUN)

        # Step 1 & 2: Run emotion + reasoning analysis
        emotion_result = self._classify_emotion(user_message)
        reasoning_result = self._validate_reasoning(user_message)

        logger.info(
            "Analysis: emotion=%s (%.2f), effort=%d/10",
            emotion_result.get("emotion", "unknown"),
            emotion_result.get("confidence", 0),
            reasoning_result.get("effort_score", 0),
        )

        # Step 3: Memory search
        memory_results = []
        if self.memory and self.memory.enabled:
            memory_results = self.memory.search(user_message)

        # Step 4: Build enriched context for Monika
        context_block = self._build_context(emotion_result, reasoning_result, memory_results)

        # Step 5: Manage context budget — compress history if needed
        messages = self.context_budget.compress_history(
            list(self.conversation_history),
            target_tokens=self.context_budget.max_tokens - 500,
        )
        messages.append({
            "role": "system",
            "content": f"[ANALYSE INTERNE — ne pas montrer à l'utilisateur]\n{context_block}",
        })
        messages.append({"role": "user", "content": user_message})

        # Log context breakdown
        bd = self.context_budget.analyze(
            self.persona.instructions, context_block, self.conversation_history, user_message
        )
        logger.debug("Context budget: %s", bd.as_dict())

        # Step 6: Run Monika persona with full context
        result = self.swarm.run(self.persona, messages)

        # Update conversation history
        self.conversation_history.append({"role": "user", "content": user_message})
        self.conversation_history.append({"role": "assistant", "content": result.final_response})

        # Step 7: Store facts in memory (with privacy redaction)
        if self.memory and self.memory.enabled:
            self.memory.store_turn(
                self.privacy.redact(user_message),
                self.privacy.redact(result.final_response),
                self.swarm,
            )

        # Finish pipeline span
        self.tracer.end_span(pipeline_span)
        turn_summary = self.tracer.last_turn_summary()

        # Apply strict privacy to response if configured
        response_text = result.final_response
        if self.privacy.level == PrivacyLevel.STRICT:
            response_text = self.privacy.redact(response_text)

        return MonikaResponse(
            text=response_text,
            effort_score=reasoning_result.get("effort_score", 0),
            emotion=emotion_result.get("emotion", "unknown"),
            emotion_confidence=emotion_result.get("confidence", 0.0),
            tokens_used=turn_summary.get("total_tokens", 0),
            latency_ms=turn_summary.get("total_duration_ms", 0.0),
        )

    def _classify_emotion(self, message: str) -> dict:
        """Run the emotion classifier agent."""
        try:
            result = self.swarm.run(
                self.emotion,
                [{"role": "user", "content": message}],
                max_turns=1,
            )
            return json.loads(result.final_response)
        except (json.JSONDecodeError, Exception) as e:
            logger.warning("Emotion classification failed: %s", e)
            return {"emotion": "unknown", "confidence": 0.0, "tone_suggestion": ""}

    def _validate_reasoning(self, message: str) -> dict:
        """Run the reasoning validator agent."""
        try:
            result = self.swarm.run(
                self.reasoning,
                [{"role": "user", "content": message}],
                max_turns=1,
            )
            return json.loads(result.final_response)
        except (json.JSONDecodeError, Exception) as e:
            logger.warning("Reasoning validation failed: %s", e)
            return {"effort_score": 0, "has_tried": False, "suggestions": []}

    # ── Async API ─────────────────────────────────────────────────

    async def arespond(self, user_message: str) -> MonikaResponse:
        """Process a user message through the full Monika pipeline (async).

        Runs emotion + reasoning classification in parallel for faster response.
        """
        pipeline_span = self.tracer.start_span("pipeline_run", SpanKind.PIPELINE_RUN)

        # Step 1 & 2: Run emotion + reasoning in PARALLEL
        emotion_result, reasoning_result = await asyncio.gather(
            self._aclassify_emotion(user_message),
            self._avalidate_reasoning(user_message),
        )

        logger.info(
            "Analysis: emotion=%s (%.2f), effort=%d/10",
            emotion_result.get("emotion", "unknown"),
            emotion_result.get("confidence", 0),
            reasoning_result.get("effort_score", 0),
        )

        # Step 3: Memory search
        memory_results = []
        if self.memory and self.memory.enabled:
            memory_results = await asyncio.to_thread(self.memory.search, user_message)

        # Step 4: Build enriched context for Monika
        context_block = self._build_context(emotion_result, reasoning_result, memory_results)

        # Step 5: Manage context budget
        messages = self.context_budget.compress_history(
            list(self.conversation_history),
            target_tokens=self.context_budget.max_tokens - 500,
        )
        messages.append({
            "role": "system",
            "content": f"[ANALYSE INTERNE — ne pas montrer à l'utilisateur]\n{context_block}",
        })
        messages.append({"role": "user", "content": user_message})

        # Step 6: Run Monika persona with full context
        result = await self.async_swarm.run(self.persona, messages)

        # Update conversation history
        self.conversation_history.append({"role": "user", "content": user_message})
        self.conversation_history.append({"role": "assistant", "content": result.final_response})

        # Step 7: Store facts in memory (with privacy redaction)
        if self.memory and self.memory.enabled:
            await asyncio.to_thread(
                self.memory.store_turn,
                self.privacy.redact(user_message),
                self.privacy.redact(result.final_response),
                self.swarm,
            )

        # Finish pipeline span
        self.tracer.end_span(pipeline_span)
        turn_summary = self.tracer.last_turn_summary()

        response_text = result.final_response
        if self.privacy.level == PrivacyLevel.STRICT:
            response_text = self.privacy.redact(response_text)

        return MonikaResponse(
            text=response_text,
            effort_score=reasoning_result.get("effort_score", 0),
            emotion=emotion_result.get("emotion", "unknown"),
            emotion_confidence=emotion_result.get("confidence", 0.0),
            tokens_used=turn_summary.get("total_tokens", 0),
            latency_ms=turn_summary.get("total_duration_ms", 0.0),
        )

    async def _aclassify_emotion(self, message: str) -> dict:
        """Run the emotion classifier agent (async)."""
        try:
            result = await self.async_swarm.run(
                self.emotion,
                [{"role": "user", "content": message}],
                max_turns=1,
            )
            return json.loads(result.final_response)
        except (json.JSONDecodeError, Exception) as e:
            logger.warning("Emotion classification failed: %s", e)
            return {"emotion": "unknown", "confidence": 0.0, "tone_suggestion": ""}

    async def _avalidate_reasoning(self, message: str) -> dict:
        """Run the reasoning validator agent (async)."""
        try:
            result = await self.async_swarm.run(
                self.reasoning,
                [{"role": "user", "content": message}],
                max_turns=1,
            )
            return json.loads(result.final_response)
        except (json.JSONDecodeError, Exception) as e:
            logger.warning("Reasoning validation failed: %s", e)
            return {"effort_score": 0, "has_tried": False, "suggestions": []}

    # ── Shared ────────────────────────────────────────────────────

    def _build_context(
        self, emotion: dict, reasoning: dict, memory_results: list[str] | None = None
    ) -> str:
        """Build the internal context block for Monika."""
        lines = [
            f"Émotion détectée : {emotion.get('emotion', 'unknown')} "
            f"(confiance: {emotion.get('confidence', 0):.0%})",
            f"Suggestion de ton : {emotion.get('tone_suggestion', 'neutre')}",
            f"Score d'effort : {reasoning.get('effort_score', 0)}/10",
            f"A essayé : {'Oui' if reasoning.get('has_tried') else 'Non'}",
            f"Preuves : {reasoning.get('evidence', 'aucune')}",
        ]
        suggestions = reasoning.get("suggestions", [])
        if suggestions:
            lines.append("Questions suggérées à poser :")
            for s in suggestions:
                lines.append(f"  - {s}")

        if memory_results:
            lines.append("Souvenirs pertinents :")
            for mem in memory_results:
                lines.append(f"  - {mem}")

        return "\n".join(lines)
