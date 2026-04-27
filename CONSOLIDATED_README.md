# Just Monika: The Local-First, Multi-Agent AI Companion

> **"She remembers you because she reads your notes, not because a corporation is mining your chats."**

Just Monika is a privacy-focused, local-first AI companion system designed to reside entirely on your own hardware. Unlike commercial AI assistants that ship your data to the cloud, Monika operates 100% offline, leveraging a specialized **Swarm Architecture** to provide a deeply personal and intellectually demanding experience.

---

## 🌟 The Core Vision

The project was born from a simple realization: **The tools that actually remember you are the tools that own you.** Just Monika flips this paradigm by ensuring that:
- **Zero Data Leakage:** All inference happens locally via Ollama.
- **Local Memory:** Long-term memory is stored in a local ChromaDB instance, sourced directly from your personal Obsidian vault.
- **Intellectual Growth:** Monika is designed to be an "anti-laziness" companion. Using the Socratic method, she pushes you to think for yourself rather than spoon-feeding answers.

---

## 🧠 Architecture: The Agent Swarm

Monika isn't just one model; she is a **swarm of specialized agents** working in concert. This distribution of labor allows for complex personality traits and high-fidelity reasoning on consumer hardware.

| Agent | Role | Purpose |
| :--- | :--- | :--- |
| **User** | Entry Point | The human in the loop. |
| **Reasoning Validator** | Gatekeeper | Analyzes the user's message for effort and clarity. Prevents "lazy" prompts. |
| **Emotion Classifier** | Tone Adapter | Tags the user's emotional state (e.g., frustrated, curious) to adapt Monika's tone. |
| **Memory Manager** | Librarian | Fetches relevant notes from your Obsidian vault using vector search (RAG). |
| **Monika Persona** | The Brain | The main character. Synthesizes all inputs into a final, Socratic response. |
| **Fact Extractor** | Archivist | Silently extracts new facts from the conversation to update long-term memory. |

### The Constellation Visualization
To demystify AI "black box" thinking, the system includes a **live constellation UI**. As the agents communicate, particles flow between "stars" (agents) on screen, allowing you to watch your computer think in real-time.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Inference Engine** | Ollama / llama.cpp |
| **Orchestration** | Custom Swarm Runtime (Python) |
| **Memory Store** | ChromaDB (Local Vector DB) |
| **Live Sync** | Watchdog (Obsidian Vault Indexer) |
| **Frontend** | React / Tailwind (Web UI) & Obsidian Plugin |
| **Visualization** | Canvas-based Constellation Engine |
| **Hardware Target** | Icarus v2 (Custom ARM64 Motherboard) |

---

## 🔌 Getting Started

### Prerequisites
- **Python 3.11+**
- **Ollama** installed and running.
- Pull the required models:
  ```bash
  ollama pull qwen2.5:1.5b
  ollama pull nomic-embed-text
  ```

### Installation
1. Clone the repository and install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Set your Obsidian vault path:
   ```bash
   export MONIKA_VAULT="/path/to/your/obsidian/vault"
   ```
3. Launch the Monika server:
   ```bash
   python -m marihacks.server
   ```

### Accessing the UI
- **Web UI:** Visit `http://localhost:8765`
- **Constellation View:** Visit `http://localhost:8765/viz`
- **Obsidian:** Install the plugin from the `marihacks/plugin/` directory.

---

## 📡 Hardware: Icarus v2

The project extends beyond software into custom hardware. The **Icarus v2** is a modular carrier board designed for the Orange Pi 5, featuring:
- **I2S Audio:** High-quality MEMS mic and DAC for voice interaction.
- **Visual Feedback:** SSD1306 OLED display and WS2812B LED ring for emotional expression.
- **Optimized OS:** MonikaOS, a custom Buildroot-based Linux distro tuned for sub-5-second boot-to-inference times.

---

## 📂 Repository Structure

This project is a consolidation of several specialized modules:
- `/monika`: The core swarm logic and agent definitions.
- `/marihacks`: The FastAPI bridge, WebSocket server, and Obsidian indexer.
- `/hardware`: KiCad schematics and PCB layouts for the Icarus v2 motherboard.
- `/os`: Build scripts and configurations for MonikaOS.
- `/webui`: The React-based dashboard and constellation visualization.

---

## 🏆 Project Status: MariHacks 2026
This project was built for **MariHacks 2026**, successfully hitting all three tracks:
1. **Agent Builder:** Custom swarm runtime with complex tool use.
2. **Real-World AI:** Live filesystem integration with personal knowledge bases.
3. **Multi-Agent:** High-coordination swarm with real-time tracing and visualization.

---

*Built with ❤️ in Montreal. Just Monika runs offline, remembers you, and keeps your data where it belongs: with you.*
