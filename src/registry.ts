export interface RegistryAgent {
  id: string;
  name: string;
  description: string;
  model: string;
  color: string;
  category: string;
  provider: 'gemini' | 'ollama' | 'huggingface';
  source?: string;
  source_id?: string;
}

export const agentRegistry: RegistryAgent[] = [
  {
    id: "conductor",
    name: "conductor",
    description: "Context-driven development specialist. Orchestrates complex technical workflows.",
    model: "gemini-3.1-pro-preview",
    color: "#ffca3a",
    category: "Orchestration",
    provider: "gemini",
    source: "https://github.com/wshobson/agents"
  },
  {
    id: "agent_teams",
    name: "teams",
    description: "Multi-agent coordination layer. Manages sub-task delegation and synthesis.",
    model: "gemini-3.1-pro-preview",
    color: "#1982c4",
    category: "Orchestration",
    provider: "gemini"
  },
  {
    id: "security_hardener",
    name: "security",
    description: "Automated security audits and hardening for code and high-level architecture.",
    model: "gemini-3-flash-preview",
    color: "#6a4c93",
    category: "Security",
    provider: "gemini"
  },
  {
    id: "fullstack_dev",
    name: "fullstack",
    description: "End-to-end feature development agent. Handles frontend, backend, and DB migrations.",
    model: "gemini-3.1-pro-preview",
    color: "#8ac926",
    category: "Development",
    provider: "gemini"
  },
  {
    id: "plugin_eval",
    name: "evaluator",
    description: "Quality evaluation framework. Benchmarks agent outputs against gold standards.",
    model: "gemini-3-flash-preview",
    color: "#ff595e",
    category: "Analysis",
    provider: "gemini"
  },
  {
    id: "k8s_architect",
    name: "k8s",
    description: "Kubernetes and infrastructure-as-code specialist. Manages deployments.",
    model: "gemini-3-flash-preview",
    color: "#5271ff",
    category: "Infrastructure",
    provider: "gemini"
  },
  {
    id: "workflow_architect",
    name: "workflow",
    description: "Visual automation and node-based configuration specialist. Inspired by n8n architecture.",
    model: "gemini-3-flash-preview",
    color: "#ff8c00",
    category: "Automation",
    provider: "gemini",
    source: "https://github.com/n8n-io/n8n"
  },
  {
    id: "lobster_operator",
    name: "lobster",
    description: "Cross-platform operator and skill management agent. Inspired by OpenClaw 'The lobster way'.",
    model: "gemini-3.1-pro-preview",
    color: "#ff4d4d",
    category: "Assistance",
    provider: "gemini",
    source: "https://github.com/openclaw/openclaw"
  },
  {
    id: "evodev_specialist",
    name: "evodev",
    description: "Self-correcting logic evolution and GEP protocol specialist. Optimizes architectures via iteration.",
    model: "gemini-3.1-pro-preview",
    color: "#00ff9d",
    category: "Evolution",
    provider: "gemini",
    source: "https://github.com/gepa-ai/gepa"
  },
  {
    id: "tiny_programmer",
    name: "tiny_dev",
    description: "Lightweight programming assistant for rapid prototyping and micro-tool generation.",
    model: "gemini-3-flash-preview",
    color: "#3dfff3",
    category: "Development",
    provider: "gemini",
    source: "https://github.com/cuneytozseker/TinyProgrammer"
  },
  {
    id: "hermes_orchestrator",
    name: "hermes",
    description: "Function CALLING & reasoning specialist. Orchestrates complex tool execution and logic routing using Hermes-2-Pro architecture.",
    model: "NousResearch/Hermes-2-Pro-Llama-3-8B",
    color: "#d4af37",
    category: "Orchestration",
    provider: "huggingface",
    source: "https://github.com/NousResearch/hermes-agent"
  },
  {
    id: "web_search",
    name: "search",
    description: "Real-time web intelligence and grounding agent. Interfaces with Google Search.",
    model: "gemini-3-flash-preview",
    color: "#4285f4",
    category: "Intelligence",
    provider: "gemini"
  }
];
