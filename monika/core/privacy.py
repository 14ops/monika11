"""
Privacy Shield — PII detection and redaction for Monika.

Inspired by DreamServer's Privacy Shield. Detects and redacts sensitive
data (emails, phones, API keys, etc.) before it reaches memory storage
or trace logs. Pure regex — zero external dependencies.
"""

from __future__ import annotations

import re
from enum import Enum


class PrivacyLevel(str, Enum):
    OFF = "off"                  # No redaction
    MEMORY_ONLY = "memory_only"  # Redact only in memory/traces (default)
    STRICT = "strict"            # Redact everything including live responses


# Compiled regex patterns for PII detection
_PATTERNS: list[tuple[str, re.Pattern]] = [
    # Email addresses
    ("EMAIL", re.compile(
        r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
    )),
    # Credit card numbers (must come before PHONE — 16 digits with separators)
    ("CARD", re.compile(
        r"\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b"
    )),
    # French social security number (must come before PHONE — 13 or 15 digits)
    ("SSN", re.compile(
        r"\b[12]\d{12,14}\b"
    )),
    # IP addresses (IPv4 — must come before PHONE)
    ("IP", re.compile(
        r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}"
        r"(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
    )),
    # Phone numbers (international + French formats)
    ("PHONE", re.compile(
        r"(?:\+\d{1,3}[-.\s]?)"                     # requires + for international
        r"(?:\(?\d{1,4}\)?[-.\s]?)?"
        r"(?:\d{2}[-.\s]?){3,4}\d{0,2}\b"
        r"|"
        r"\b0[1-9](?:[-.\s]?\d{2}){4}\b"            # French: 0X XX XX XX XX
    )),
    # API keys / tokens (long hex or base64 strings, 32+ chars)
    ("TOKEN", re.compile(
        r"\b(?:sk-|pk-|ghp_|gho_|glpat-|xox[bpas]-|AKIA)"
        r"[A-Za-z0-9_\-]{20,}\b"
    )),
    # Generic long hex strings (likely secrets)
    ("TOKEN", re.compile(
        r"\b[0-9a-fA-F]{32,}\b"
    )),
    # URLs with sensitive query parameters
    ("URL_AUTH", re.compile(
        r"(?:password|passwd|pwd|secret|token|api_key|apikey|access_token|auth)"
        r"=[^\s&]+",
        re.IGNORECASE,
    )),
]


class PrivacyShield:
    """
    Detects and redacts PII from text using regex patterns.

    Usage:
        shield = PrivacyShield(level=PrivacyLevel.MEMORY_ONLY)
        clean = shield.redact("Contact me at john@example.com")
        # "Contact me at [EMAIL]"
    """

    def __init__(self, level: PrivacyLevel = PrivacyLevel.MEMORY_ONLY):
        self.level = level

    @property
    def enabled(self) -> bool:
        return self.level != PrivacyLevel.OFF

    def redact(self, text: str) -> str:
        """Replace all detected PII with placeholder tags."""
        if not self.enabled or not text:
            return text

        result = text
        for tag, pattern in _PATTERNS:
            result = pattern.sub(f"[{tag}]", result)
        return result

    def redact_messages(self, messages: list[dict]) -> list[dict]:
        """Redact PII from a list of chat messages (returns new list)."""
        if not self.enabled:
            return messages
        return [
            {**msg, "content": self.redact(msg.get("content", ""))}
            if msg.get("content")
            else msg
            for msg in messages
        ]

    def scan(self, text: str) -> list[dict]:
        """Scan text for PII and return matches (for reporting, not redaction)."""
        findings = []
        for tag, pattern in _PATTERNS:
            for match in pattern.finditer(text):
                findings.append({
                    "type": tag,
                    "match": match.group(),
                    "start": match.start(),
                    "end": match.end(),
                })
        return findings
