"""
Context Budget Manager — Prevents context window overflow.

Inspired by Context Lens's context composition analysis. Tracks token usage
per category (system prompt, history, analysis block) and compresses old
conversation history when approaching the model's context limit.
Zero external dependencies — uses a simple word-based token estimator.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Rough token estimation: ~1.3 tokens per word for English/French.
# More accurate than char-based (~4 chars/token) for mixed content.
TOKENS_PER_WORD = 1.3
# Safety margin to account for underestimation on code/JSON/URLs
SAFETY_MARGIN = 1.15


def estimate_tokens(text: str) -> int:
    """Estimate token count from text. Simple, no dependencies.

    Applies a 15% safety margin to guard against underestimation
    on code, JSON, and URL-heavy content.
    """
    if not text:
        return 0
    words = text.split()
    return max(1, int(len(words) * TOKENS_PER_WORD * SAFETY_MARGIN))


def estimate_messages_tokens(messages: list[dict]) -> int:
    """Estimate total tokens for a list of chat messages."""
    total = 0
    for msg in messages:
        # ~4 tokens overhead per message (role, formatting)
        total += 4
        content = msg.get("content", "")
        if content:
            total += estimate_tokens(content)
    return total


@dataclass
class ContextBreakdown:
    """Token usage breakdown by category."""
    system_prompt: int = 0
    analysis_block: int = 0
    conversation_history: int = 0
    user_message: int = 0
    total: int = 0
    max_tokens: int = 0

    @property
    def usage_percent(self) -> float:
        if self.max_tokens == 0:
            return 0.0
        return (self.total / self.max_tokens) * 100

    def as_dict(self) -> dict:
        return {
            "system_prompt": self.system_prompt,
            "analysis_block": self.analysis_block,
            "conversation_history": self.conversation_history,
            "user_message": self.user_message,
            "total": self.total,
            "max_tokens": self.max_tokens,
            "usage_percent": f"{self.usage_percent:.1f}%",
        }


class ContextBudget:
    """
    Manages context window budget for the Monika pipeline.

    Tracks token usage per category and compresses conversation history
    when approaching the model's context limit.
    """

    def __init__(self, max_tokens: int = 4096, keep_recent_turns: int = 4):
        self.max_tokens = max_tokens
        self.keep_recent_turns = keep_recent_turns
        self._last_breakdown: ContextBreakdown | None = None

    def analyze(
        self,
        system_prompt: str,
        analysis_block: str,
        conversation_history: list[dict],
        user_message: str,
    ) -> ContextBreakdown:
        """Analyze current context token usage by category."""
        bd = ContextBreakdown(
            system_prompt=estimate_tokens(system_prompt),
            analysis_block=estimate_tokens(analysis_block),
            conversation_history=estimate_messages_tokens(conversation_history),
            user_message=estimate_tokens(user_message),
            max_tokens=self.max_tokens,
        )
        bd.total = bd.system_prompt + bd.analysis_block + bd.conversation_history + bd.user_message
        self._last_breakdown = bd
        return bd

    def needs_compression(
        self,
        system_prompt: str,
        analysis_block: str,
        conversation_history: list[dict],
        user_message: str,
        reserve_for_response: int = 500,
    ) -> bool:
        """Check if context needs compression to fit within budget."""
        bd = self.analyze(system_prompt, analysis_block, conversation_history, user_message)
        return bd.total > (self.max_tokens - reserve_for_response)

    def compress_history(
        self,
        messages: list[dict],
        target_tokens: int | None = None,
    ) -> list[dict]:
        """
        Compress conversation history to fit within token budget.

        Strategy:
        1. Keep the last N turns (user+assistant pairs) intact
        2. Summarize older turns into a single "Previously:" message
        3. If still over budget, truncate the summary
        """
        if not messages:
            return messages

        target = target_tokens or (self.max_tokens - 500)
        current_tokens = estimate_messages_tokens(messages)

        if current_tokens <= target:
            return messages

        # Split into old and recent messages
        # Each turn = 2 messages (user + assistant)
        keep_count = self.keep_recent_turns * 2
        if len(messages) <= keep_count:
            # Not enough messages to compress — keep all
            return messages

        old_messages = messages[:-keep_count]
        recent_messages = messages[-keep_count:]

        # Extractive summary of old messages: keep first sentence of each
        summary_parts = []
        for msg in old_messages:
            content = msg.get("content", "")
            if not content:
                continue
            role = msg.get("role", "")
            # Take first sentence (up to first period, question mark, or 100 chars)
            first_sentence = content
            for end_char in ".?!\n":
                idx = content.find(end_char)
                if 0 < idx < 200:
                    first_sentence = content[:idx + 1]
                    break
            else:
                if len(content) > 100:
                    first_sentence = content[:100] + "..."

            if role == "user":
                summary_parts.append(f"- User: {first_sentence}")
            elif role == "assistant":
                summary_parts.append(f"- Monika: {first_sentence}")

        if summary_parts:
            summary_text = "Previously in this conversation:\n" + "\n".join(summary_parts)

            # Truncate summary if still too large
            summary_tokens = estimate_tokens(summary_text)
            recent_tokens = estimate_messages_tokens(recent_messages)
            available = target - recent_tokens - 50  # small buffer

            if summary_tokens > available and available > 0:
                # Truncate to fit
                words = summary_text.split()
                max_words = int(available / TOKENS_PER_WORD)
                summary_text = " ".join(words[:max_words]) + "..."

            compressed = [{"role": "system", "content": summary_text}]
            compressed.extend(recent_messages)

            logger.debug(
                "Context compressed: %d messages -> %d (%d old summarized, %d recent kept)",
                len(messages),
                len(compressed),
                len(old_messages),
                len(recent_messages),
            )
            return compressed

        return recent_messages

    @property
    def last_breakdown(self) -> ContextBreakdown | None:
        return self._last_breakdown
