"""
Just Monika — Local LLM Swarm Orchestrator

Lightweight multi-agent orchestrator inspired by OpenAI's Swarm pattern.
Designed to work 100% locally with Ollama as the inference backend.
No cloud dependencies. No data leaves the device.
"""

from __future__ import annotations

import asyncio
import inspect
import json
from dataclasses import dataclass, field
from typing import Any, Callable

from openai import AsyncOpenAI, OpenAI

from monika.core.tracing import SpanKind, Tracer


@dataclass
class Agent:
    """A specialized agent in the Monika swarm."""
    name: str
    model: str
    instructions: str
    tools: list[dict] = field(default_factory=list)
    tool_map: dict[str, Callable] = field(default_factory=dict)

    def register_tool(self, func: Callable, description: str, parameters: dict):
        """Register a callable as a tool for this agent."""
        tool_def = {
            "type": "function",
            "function": {
                "name": func.__name__,
                "description": description,
                "parameters": parameters,
            },
        }
        self.tools.append(tool_def)
        self.tool_map[func.__name__] = func


@dataclass
class SwarmResult:
    """Result of a swarm orchestration run."""
    agent: Agent
    messages: list[dict]
    final_response: str
    metadata: dict = field(default_factory=dict)


class MonikaSwarm:
    """
    Orchestrates multiple local LLM agents for the Just Monika system.

    Uses Ollama's OpenAI-compatible API as the inference backend.
    Supports agent handoffs, tool calling, shared context, and tracing.
    """

    def __init__(self, base_url: str = "http://localhost:11434/v1", tracer: Tracer | None = None):
        self.client = OpenAI(base_url=base_url, api_key="local")
        self.shared_context: dict[str, Any] = {}
        self.tracer = tracer or Tracer(enabled=False)

    def run(
        self,
        agent: Agent,
        messages: list[dict],
        max_turns: int = 10,
    ) -> SwarmResult:
        """
        Run the swarm loop: send messages to the active agent,
        handle tool calls and handoffs, return the final result.
        """
        current_agent = agent
        history = list(messages)

        for _ in range(max_turns):
            response = self._call_llm(current_agent, history)
            message = response.choices[0].message

            # No tool calls — we have a final response
            if not message.tool_calls:
                history.append({"role": "assistant", "content": message.content})
                return SwarmResult(
                    agent=current_agent,
                    messages=history,
                    final_response=message.content or "",
                    metadata={"shared_context": self.shared_context},
                )

            # Process tool calls
            history.append(message.model_dump())
            for tool_call in message.tool_calls:
                result = self._execute_tool(current_agent, tool_call)

                # Handle agent handoff
                if isinstance(result, Agent):
                    span = self.tracer.start_span(
                        f"handoff:{current_agent.name}->{result.name}",
                        SpanKind.AGENT_HANDOFF,
                        agent_name=current_agent.name,
                        metadata={"target_agent": result.name},
                    )
                    self.tracer.end_span(span)
                    current_agent = result
                    history.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": f"[Handoff to {result.name}]",
                    })
                else:
                    history.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": self._format_tool_result(result),
                    })

        # Max turns reached
        return SwarmResult(
            agent=current_agent,
            messages=history,
            final_response="[Max turns reached]",
            metadata={"shared_context": self.shared_context},
        )

    def _call_llm(self, agent: Agent, messages: list[dict]):
        """Call the local LLM via Ollama's OpenAI-compatible API."""
        span = self.tracer.start_span(
            f"llm:{agent.name}",
            SpanKind.LLM_CALL,
            agent_name=agent.name,
            model=agent.model,
        )
        try:
            system_msg = {"role": "system", "content": agent.instructions}
            kwargs = {
                "model": agent.model,
                "messages": [system_msg] + messages,
            }
            if agent.tools:
                kwargs["tools"] = agent.tools
            response = self.client.chat.completions.create(**kwargs)

            # Record token usage from response
            if hasattr(response, "usage") and response.usage:
                span.input_tokens = response.usage.prompt_tokens or 0
                span.output_tokens = response.usage.completion_tokens or 0

            self.tracer.end_span(span)
            return response
        except Exception as e:
            span.error = str(e)
            self.tracer.end_span(span)
            raise

    def _execute_tool(self, agent: Agent, tool_call) -> Any:
        """Execute a tool call and return the result (or an Agent for handoff)."""
        name = tool_call.function.name
        span = self.tracer.start_span(
            f"tool:{name}",
            SpanKind.TOOL_CALL,
            agent_name=agent.name,
            metadata={"function": name, "arguments": tool_call.function.arguments},
        )
        func = agent.tool_map.get(name)
        if func is None:
            span.error = f"unknown tool '{name}'"
            self.tracer.end_span(span)
            return f"Error: unknown tool '{name}'"

        args = json.loads(tool_call.function.arguments)
        # Inject shared context if the function signature accepts it
        sig = inspect.signature(func)
        if "context" in sig.parameters:
            args["context"] = self.shared_context
        result = self._invoke_tool(func, args)

        self.tracer.end_span(span)
        return result

    def _invoke_tool(self, func: Callable, args: dict[str, Any]) -> Any:
        """Invoke a tool function, including coroutine tools when needed."""
        result = func(**args)
        if inspect.isawaitable(result):
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                return asyncio.run(result)
            raise RuntimeError(
                "Async tool functions require AsyncMonikaSwarm when called from an event loop"
            )
        return result

    @staticmethod
    def _format_tool_result(result: Any) -> str:
        """Convert tool output into a string suitable for chat history."""
        if isinstance(result, str):
            return result
        if isinstance(result, (dict, list, tuple)):
            return json.dumps(result, ensure_ascii=False)
        return str(result)


class AsyncMonikaSwarm:
    """
    Async version of MonikaSwarm for parallel agent execution.

    Uses AsyncOpenAI to allow concurrent LLM calls via asyncio.gather().
    """

    def __init__(self, base_url: str = "http://localhost:11434/v1", tracer: Tracer | None = None):
        self.client = AsyncOpenAI(base_url=base_url, api_key="local")
        self.shared_context: dict[str, Any] = {}
        self.tracer = tracer or Tracer(enabled=False)

    async def run(
        self,
        agent: Agent,
        messages: list[dict],
        max_turns: int = 10,
    ) -> SwarmResult:
        """Async swarm loop: same logic as sync version but with awaited LLM calls."""
        current_agent = agent
        history = list(messages)

        for _ in range(max_turns):
            response = await self._call_llm(current_agent, history)
            message = response.choices[0].message

            if not message.tool_calls:
                history.append({"role": "assistant", "content": message.content})
                return SwarmResult(
                    agent=current_agent,
                    messages=history,
                    final_response=message.content or "",
                    metadata={"shared_context": self.shared_context},
                )

            history.append(message.model_dump())
            for tool_call in message.tool_calls:
                result = await self._execute_tool(current_agent, tool_call)

                if isinstance(result, Agent):
                    span = self.tracer.start_span(
                        f"handoff:{current_agent.name}->{result.name}",
                        SpanKind.AGENT_HANDOFF,
                        agent_name=current_agent.name,
                        metadata={"target_agent": result.name},
                    )
                    self.tracer.end_span(span)
                    current_agent = result
                    history.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": f"[Handoff to {result.name}]",
                    })
                else:
                    history.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": self._format_tool_result(result),
                    })

        return SwarmResult(
            agent=current_agent,
            messages=history,
            final_response="[Max turns reached]",
            metadata={"shared_context": self.shared_context},
        )

    async def _call_llm(self, agent: Agent, messages: list[dict]):
        """Call the local LLM via Ollama's async OpenAI-compatible API."""
        span = self.tracer.start_span(
            f"llm:{agent.name}",
            SpanKind.LLM_CALL,
            agent_name=agent.name,
            model=agent.model,
        )
        try:
            system_msg = {"role": "system", "content": agent.instructions}
            kwargs = {
                "model": agent.model,
                "messages": [system_msg] + messages,
            }
            if agent.tools:
                kwargs["tools"] = agent.tools
            response = await self.client.chat.completions.create(**kwargs)

            if hasattr(response, "usage") and response.usage:
                span.input_tokens = response.usage.prompt_tokens or 0
                span.output_tokens = response.usage.completion_tokens or 0

            self.tracer.end_span(span)
            return response
        except Exception as e:
            span.error = str(e)
            self.tracer.end_span(span)
            raise

    async def _execute_tool(self, agent: Agent, tool_call) -> Any:
        """Execute a tool call with coroutine-aware tool handling."""
        name = tool_call.function.name
        span = self.tracer.start_span(
            f"tool:{name}",
            SpanKind.TOOL_CALL,
            agent_name=agent.name,
            metadata={"function": name, "arguments": tool_call.function.arguments},
        )
        func = agent.tool_map.get(name)
        if func is None:
            span.error = f"unknown tool '{name}'"
            self.tracer.end_span(span)
            return f"Error: unknown tool '{name}'"

        args = json.loads(tool_call.function.arguments)
        sig = inspect.signature(func)
        if "context" in sig.parameters:
            args["context"] = self.shared_context
        result = await self._invoke_tool(func, args)

        self.tracer.end_span(span)
        return result

    async def _invoke_tool(self, func: Callable, args: dict[str, Any]) -> Any:
        """Invoke sync or async tool functions in the async swarm."""
        result = func(**args)
        if inspect.isawaitable(result):
            return await result
        return result

    @staticmethod
    def _format_tool_result(result: Any) -> str:
        """Convert tool output into a string suitable for chat history."""
        if isinstance(result, str):
            return result
        if isinstance(result, (dict, list, tuple)):
            return json.dumps(result, ensure_ascii=False)
        return str(result)
