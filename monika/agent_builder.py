"""
Monika Agent Builder mode.

Turns Monika into an action-taking coding agent with real tools:
- list/read/write files in a workspace
- create directories
- run shell commands in that workspace
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from monika.core.swarm import Agent, MonikaSwarm, SwarmResult

BUILDER_INSTRUCTIONS = """You are Monika in Builder Mode: an autonomous coding agent.

You MUST build by taking actions with tools, not only by describing a plan.

Rules:
1. Keep all file operations inside the provided workspace.
2. First inspect workspace state (list/read), then create or modify files.
3. Run commands to validate progress when useful.
4. If a command fails, iterate with concrete fixes.
5. End with a concise final report:
   - what you built
   - files changed
   - commands run and outcomes
   - next manual step (if any)

Tool protocol:
- Prefer native tool/function calling when available.
- If native tool calling is unavailable, output JSON actions only:
  {"name":"tool_name","parameters":{...}}
  or {"actions":[{"name":"tool_name","parameters":{...}}]}
- Supported tool names:
  list_files, read_file, write_file, append_file, make_directory, run_command
- When done, include the marker FINAL_REPORT in your message.
"""


class WorkspaceTools:
    """Safe workspace-scoped tools for the Builder agent."""

    def __init__(self, workspace: Path):
        self.workspace = workspace.resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)

    def _resolve_safe(self, path: str) -> Path:
        clean = path.strip().lstrip("/\\") or "."
        target = (self.workspace / clean).resolve()
        target.relative_to(self.workspace)
        return target

    def list_files(self, path: str = ".") -> list[str]:
        """List files and directories under a workspace path."""
        try:
            target = self._resolve_safe(path)
        except ValueError:
            return [f"ERROR: path escapes workspace: {path}"]
        if not target.exists():
            return []
        if target.is_file():
            return [str(target.relative_to(self.workspace))]

        items: list[str] = []
        for entry in sorted(target.iterdir(), key=lambda p: p.name.lower()):
            rel = str(entry.relative_to(self.workspace))
            items.append(rel + ("/" if entry.is_dir() else ""))
        return items

    def read_file(self, path: str, max_chars: int = 12000) -> str:
        """Read a text file from the workspace."""
        try:
            target = self._resolve_safe(path)
        except ValueError:
            return f"ERROR: path escapes workspace: {path}"
        if not target.exists():
            return f"ERROR: file does not exist: {path}"
        if target.is_dir():
            return f"ERROR: path is a directory: {path}"
        data = target.read_text(encoding="utf-8")
        return data[:max_chars]

    def write_file(self, path: str, content: str) -> str:
        """Write (overwrite) a text file in the workspace."""
        try:
            target = self._resolve_safe(path)
        except ValueError:
            return f"ERROR: path escapes workspace: {path}"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"WROTE {target.relative_to(self.workspace)} ({len(content)} chars)"

    def append_file(self, path: str, content: str) -> str:
        """Append text to a file in the workspace."""
        try:
            target = self._resolve_safe(path)
        except ValueError:
            return f"ERROR: path escapes workspace: {path}"
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as f:
            f.write(content)
        return f"APPENDED {target.relative_to(self.workspace)} ({len(content)} chars)"

    def make_directory(self, path: str) -> str:
        """Create a directory in the workspace."""
        try:
            target = self._resolve_safe(path)
        except ValueError:
            return f"ERROR: path escapes workspace: {path}"
        target.mkdir(parents=True, exist_ok=True)
        return f"CREATED DIR {target.relative_to(self.workspace)}/"

    def run_command(self, command: str, timeout_seconds: int = 120) -> dict[str, Any]:
        """Run a shell command from the workspace root."""
        try:
            completed = subprocess.run(
                command,
                cwd=self.workspace,
                capture_output=True,
                text=True,
                shell=True,
                timeout=timeout_seconds,
                check=False,
            )
            return {
                "exit_code": completed.returncode,
                "stdout": completed.stdout[-8000:],
                "stderr": completed.stderr[-8000:],
            }
        except subprocess.TimeoutExpired as e:
            return {
                "exit_code": 124,
                "stdout": (e.stdout or "")[-8000:],
                "stderr": f"TIMEOUT after {timeout_seconds}s",
            }


def _register_builder_tools(agent: Agent, tools: WorkspaceTools) -> None:
    agent.register_tool(
        func=tools.list_files,
        description="List files/directories in the workspace.",
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Relative path in workspace"}},
        },
    )
    agent.register_tool(
        func=tools.read_file,
        description="Read a text file from the workspace.",
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "max_chars": {"type": "integer", "minimum": 1, "maximum": 30000},
            },
            "required": ["path"],
        },
    )
    agent.register_tool(
        func=tools.write_file,
        description="Write a text file (overwrite).",
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"],
        },
    )
    agent.register_tool(
        func=tools.append_file,
        description="Append text to a file.",
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"],
        },
    )
    agent.register_tool(
        func=tools.make_directory,
        description="Create a directory.",
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    )
    agent.register_tool(
        func=tools.run_command,
        description="Run a shell command inside the workspace.",
        parameters={
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 600},
            },
            "required": ["command"],
        },
    )


def _extract_actions_from_text(text: str) -> list[dict[str, Any]]:
    """Extract JSON tool actions from model text (fallback when native tools are unavailable)."""
    decoder = json.JSONDecoder()
    blocks = [text]
    blocks.extend(re.findall(r"```(?:json)?\s*(.*?)```", text, flags=re.IGNORECASE | re.DOTALL))

    objects: list[Any] = []
    for block in blocks:
        idx = 0
        while idx < len(block):
            start = block.find("{", idx)
            if start < 0:
                break
            try:
                obj, end = decoder.raw_decode(block[start:])
                objects.append(obj)
                idx = start + end
            except json.JSONDecodeError:
                idx = start + 1

    actions: list[dict[str, Any]] = []
    for obj in objects:
        if isinstance(obj, dict) and "actions" in obj and isinstance(obj["actions"], list):
            for action in obj["actions"]:
                if isinstance(action, dict) and isinstance(action.get("name"), str):
                    params = action.get("parameters")
                    actions.append({"name": action["name"], "parameters": params if isinstance(params, dict) else {}})
        elif isinstance(obj, dict) and isinstance(obj.get("name"), str):
            params = obj.get("parameters")
            actions.append({"name": obj["name"], "parameters": params if isinstance(params, dict) else {}})
    return actions


def _execute_action(action: dict[str, Any], tools: WorkspaceTools) -> dict[str, Any]:
    """Execute one parsed action and return a structured result."""
    tool_map = {
        "list_files": tools.list_files,
        "read_file": tools.read_file,
        "write_file": tools.write_file,
        "append_file": tools.append_file,
        "make_directory": tools.make_directory,
        "run_command": tools.run_command,
    }
    name = action.get("name", "")
    parameters = action.get("parameters") if isinstance(action.get("parameters"), dict) else {}
    func = tool_map.get(name)
    if func is None:
        return {"name": name, "parameters": parameters, "result": f"ERROR: unknown tool '{name}'"}
    try:
        result = func(**parameters)
    except TypeError as e:
        result = f"ERROR: invalid parameters for {name}: {e}"
    return {"name": name, "parameters": parameters, "result": result}


def _llm_plain_step(swarm: MonikaSwarm, agent: Agent, messages: list[dict[str, str]]) -> str:
    """Single plain chat completion step (no native tool-calling required)."""
    response = swarm.client.chat.completions.create(
        model=agent.model,
        messages=[{"role": "system", "content": agent.instructions}] + messages,
    )
    return response.choices[0].message.content or ""


def run_builder_goal(
    goal: str,
    workspace: str = ".",
    model: str = "qwen2.5:0.5b",
    ollama_url: str = "http://localhost:11434/v1",
    max_turns: int = 30,
) -> SwarmResult:
    workspace_path = Path(workspace)
    tools = WorkspaceTools(workspace_path)
    agent = Agent(
        name="monika_builder",
        model=model,
        instructions=BUILDER_INSTRUCTIONS,
    )
    _register_builder_tools(agent, tools)

    swarm = MonikaSwarm(base_url=ollama_url)
    initial_prompt = (
        f"Goal: {goal}\n\n"
        f"Workspace: {tools.workspace}\n"
        "Build the solution now using tools. Do not stop at planning.\n"
        "If native function calling is unavailable, output JSON actions and I will execute them."
    )

    native_result = swarm.run(agent, [{"role": "user", "content": initial_prompt}], max_turns=max_turns)
    used_native_tools = any(m.get("role") == "tool" for m in native_result.messages if isinstance(m, dict))
    if used_native_tools:
        return native_result

    # Fallback: parse JSON actions from assistant text and execute them manually in a loop.
    messages: list[dict[str, str]] = [
        {"role": "user", "content": initial_prompt},
        {"role": "assistant", "content": native_result.final_response},
    ]
    assistant_text = native_result.final_response
    executed_actions: list[dict[str, Any]] = []

    for _ in range(max_turns):
        actions = _extract_actions_from_text(assistant_text)
        if not actions:
            if "FINAL_REPORT" in assistant_text:
                break
            messages.append({
                "role": "user",
                "content": (
                    "No executable JSON actions detected. "
                    "Return ONLY JSON with either one action object or an actions array."
                ),
            })
            assistant_text = _llm_plain_step(swarm, agent, messages)
            messages.append({"role": "assistant", "content": assistant_text})
            continue

        step_results = [_execute_action(action, tools) for action in actions]
        executed_actions.extend(step_results)
        messages.append({
            "role": "user",
            "content": (
                "Tool execution results (JSON):\n"
                f"{json.dumps(step_results, ensure_ascii=False)}\n"
                "Continue building. Include FINAL_REPORT when done."
            ),
        })
        assistant_text = _llm_plain_step(swarm, agent, messages)
        messages.append({"role": "assistant", "content": assistant_text})
        if "FINAL_REPORT" in assistant_text:
            break

    return SwarmResult(
        agent=agent,
        messages=messages,
        final_response=assistant_text,
        metadata={"manual_actions": executed_actions, "tool_mode": "manual_json_fallback"},
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Monika Builder Mode — true action-taking agent")
    parser.add_argument("goal", help="What Monika should build")
    parser.add_argument("--workspace", default=".", help="Workspace directory for file operations")
    parser.add_argument("--model", default="qwen2.5:0.5b", help="Tool-capable model for builder")
    parser.add_argument("--ollama-url", default="http://localhost:11434/v1", help="Ollama OpenAI-compatible URL")
    parser.add_argument("--max-turns", type=int, default=30, help="Max tool/LLM turns")
    args = parser.parse_args()

    result = run_builder_goal(
        goal=args.goal,
        workspace=args.workspace,
        model=args.model,
        ollama_url=args.ollama_url,
        max_turns=args.max_turns,
    )
    print(result.final_response)


if __name__ == "__main__":
    main()
