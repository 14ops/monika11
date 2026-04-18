"""
Canonical MariHacks "Agentic Age" brief for Monika surfaces.

This keeps one source of truth so CLI and API render the same text.
"""

from __future__ import annotations


AGENTIC_AGE_BRIEF = """The Agentic Age

2025 was the year AI stopped just talking and started doing. The rise of agentic AI has
changed what's possible: AI systems that can plan, reason, use tools, and take action. AI
agents now book flights, write and execute code, browse the web, manage calendars,
and coordinate complex workflows.

At the heart of this shift is tool use: the ability for AI to call APIs, interact with external
services, and affect the real world through code. Anthropic's Model Context Protocol
(MCP) has emerged as a universal standard, allowing any model to connect to any tool or
data source.

As a MariHacks participant, your challenge is to move beyond the chatbot. Build AI
systems that don't just respond, but act. The power is in your hands.

Track 1: Agent Builder
Build an AI agent that uses tools to accomplish a meaningful task in a domain you care
about: healthcare, education, productivity, creative work, accessibility, or anything else.
Your agent should demonstrate some form of reasoning, planning, or tool use. It could be
as simple as an agent that searches the web and summarizes results, or as complex as
one that manages files and sends emails based on user intent.

Examples
- A study assistant that finds resources, creates flashcards, and quizzes you
- A personal finance helper that reads receipts and categorizes expenses
- A coding assistant that can run and test code, not just write it
- A meal planner that checks your fridge inventory and suggests recipes

Pro Tip: Start with one or two well-integrated tools rather than many shallow
integrations. Depth beats breadth.

Track 2: Real-World AI
Build an AI application that connects to the real world through APIs, external data, or
hardware. This track is more open-ended than Track 1, but your project must include at
least one meaningful integration with an external service or data source.

The focus here is on creative applications. What interesting things can you do when AI
can access real data and services?

Examples
- An AI dungeon master that saves game state and generates images for scenes
- A transit helper that uses real-time STM/bus data to suggest routes
- A music practice tool that listens to you play and gives feedback
- A weather-aware outfit recommender that checks forecasts and your calendar

Pro Tip: Think about problems you actually face.

Track 3: Multi-Agent Systems
Design a system where multiple AI agents work together. Each agent has a specialized
role, and they coordinate to accomplish something none could do alone. This track is
more challenging and experimental.

Examples
- A content pipeline: one agent researches, another writes, a third edits
- A debate simulator where agents argue different positions
- A customer service system with specialized agents for different query types
- A coding team: architect, coder, and tester agents

Pro Tip: Start with just two agents and get the handoff working before adding more
complexity.

Appendix: Getting Started

A. What is Agentic AI?
An AI agent is a system that can perceive its environment, reason about goals, and take
actions. Unlike a chatbot that only responds to prompts, agents can use tools, maintain
state across interactions, and execute multi-step plans.

Important Concepts
- Tool/Function Calling: LLMs invoking external functions
- ReAct Pattern: Reasoning + Acting loop (Think, Act, Observe, repeat)
- MCP (Model Context Protocol): Open standard for connecting AI to tools/data
- Orchestration: Managing state and flow between reasoning steps

B. Tools & Frameworks

Agent Frameworks
- LangChain / LangGraph (Python, JS)
- OpenAI Agents SDK
- Anthropic Tool Use (Claude)
- CrewAI / AutoGen (multi-agent)

Free or Low-Cost Model Options
- Ollama (run models locally for free)
- Groq (fast inference, generous free tier)
- Google AI Studio (Gemini, free tier)
- Together AI / Fireworks (affordable open models)

MCP Resources
- modelcontextprotocol.io (official docs)
- GitHub MCP Registry (directory of MCP servers)
- mcp.run (hosted MCP platform)

C. Learning Resources
If you're new to agentic AI:
- DeepLearning.AI: "Functions, Tools and Agents with LangChain"
- Anthropic's "Building Effective Agents" documentation
- LangGraph tutorials and examples
- YouTube: "Building AI Agents" by various creators

Pro Tip: Don't be intimidated. Many successful agent projects are simpler than they look.
Start small, get something working, then iterate.
"""


def is_agentic_age_request(message: str) -> bool:
    """Detect direct asks for the MariHacks brief."""
    normalized = message.lower()
    return "agentic age" in normalized or "marihacks brief" in normalized
