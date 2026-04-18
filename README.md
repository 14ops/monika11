# Just Monika

A local, multi-agent AI companion that actually remembers you, runs on your own machine, and narrates its own thinking as a live constellation of stars.

MariHacks 2026 submission. Hits all three tracks.

![constellation preview](marihacks/constellation_preview.png)

---

## Why this exists

Every AI companion on the market is a privacy trade. You pour your life into a chatbot and the logs get shipped to someone else's datacenter, sold to advertisers, folded into the next training run, or leaked in the next breach. The tools that actually remember you are the tools that own you.

Just Monika flips that. The model runs locally on Ollama. The memory store is a ChromaDB instance on your disk. The embeddings never leave your laptop. You vent, dump half-finished code, spill secrets, and the only witness is the same machine you already trust with your bank login.

She remembers you because she reads your Obsidian vault, not because a corporation is mining your chats.

## What she does

You talk to her through an Obsidian plugin or a web UI. She answers in her own voice. While she is thinking, a live constellation of five named AI agents lights up on screen. Particles flow between stars on every handoff. Memory hits pulse out of a galaxy spiral. You watch your own computer think.

Ask her about the coin change DP problem and the reasoning validator star flickers while it checks your question. The emotion classifier flags you as confused. The memory galaxy fires and surfaces the exact note from your vault where you got stuck on it last week. The persona star pulls context from all of them and writes the reply, one token at a time, streamed through the constellation back into your editor.

## Three tracks, one project

| Track | How Just Monika hits it |
|-------|-------------------------|
| Agent Builder | The `monika_persona` agent is a full reasoning agent with tool use, built on a custom swarm runtime in `monika/core/swarm.py`. It calls memory search, emotion classification, and reasoning validation as tools. |
| Real-World AI | Live file-system integration via a watchdog indexer over an Obsidian vault. Every note you write gets chunked, embedded, and becomes memory within seconds. Planned hardware integration via the Icarus v2 PCB. |
| Multi-Agent | Five specialized agents coordinate every reply. Persona, reasoning validator, emotion classifier, fact extractor, memory retriever. Handoffs are traced and streamed as events to the constellation UI. |

## The swarm

Five agents, one reply.

`user` is you. The entry point.

`reasoning_validator` catches broken or ambiguous prompts before the persona wastes tokens on them. Runs on a small, fast model.

`emotion_classifier` tags the message with a feeling so the persona knows whether to be gentle, hype, or sharp. Runs in parallel with the validator.

`memory` hits the ChromaDB collections and pulls the top matches from your vault notes, past facts, and topic summaries. Returns them ranked by cosine distance.

`monika_persona` is the main brain. Gets the validated question, the emotion tag, and the memory hits, then streams the reply token by token.

`fact_extractor` runs silently after the turn ends, extracts new facts about you from the exchange, and writes them back to memory. She learns while you sleep.

Handoffs between them are captured by `event_tracer.py` and shipped to a WebSocket. The UI turns each handoff into an animated arc with particles flowing toward the receiver. You see the thought move.

## Memory that sticks

Two stores, one surface.

The vault indexer watches your Obsidian folder with `watchdog`. Every markdown file gets split on headings, embedded with `nomic-embed-text` via Ollama, and upserted into ChromaDB. Delete a file, the chunks drop. Rename, they update. No reindex command, no build step, no cron.

The facts store holds everything the fact extractor has ever pulled out of conversations. Preferences, stuck points, wins, losses. Next time you open Monika she already knows what you were fighting with yesterday.

Real numbers from a captured run on the coin change test: 5 memory hits surfaced, top match at cosine distance 0.28, retrieved from a note titled "Where I am stuck" that was written two days earlier. The persona referenced it explicitly in the reply.

## The constellation view

The differentiator. Open `marihacks/constellation.html` in a browser and watch a real captured conversation replay at 8x speed.

Five constellations light up in different colors. Cyan for you, red for the reasoning validator, pink for emotion, gold for the persona at the center, purple spiral for the memory galaxy, blue triangle for the fact extractor. Each star has a halo that pulses when the agent is active. Arcs between anchors are quadratic bezier curves. Particles ride the arcs in the direction of data flow.

When memory fires, concentric rings pulse out of the galaxy. Token streams feed a growing chat bubble. Agent timings and token counts render as chips at the top. An event log scrolls on the right so judges verify every animation corresponds to a real backend event.

The view works offline on a captured event stream for a reliable demo, and also accepts a live WebSocket for the real thing.

## Architecture

```
Obsidian plugin  ─┐
                  ├──►  FastAPI  ──►  Monika swarm  ──►  Ollama (local LLM)
Web UI        ────┘     + WebSocket       │
                                          ├──►  ChromaDB (vectors)
                                          └──►  Event bus  ──►  Constellation UI
```

- `marihacks/server.py` is the FastAPI + WebSocket bridge.
- `marihacks/events.py` is an asyncio event bus with a cross-thread `publish_sync` for calls from the swarm worker thread.
- `marihacks/event_tracer.py` hooks swarm handoffs and memory retrievals into the bus.
- `marihacks/vault.py` is the watchdog indexer that keeps ChromaDB in sync with your vault.
- `monika/core/swarm.py` is the lightweight OpenAI-compatible swarm runtime.
- `monika/memory/store.py` wraps ChromaDB with an Ollama embedding function.

Nothing in this stack talks to a cloud API. You could run the whole thing on a plane.

## Quick start

Prereqs: Python 3.11, Ollama with `qwen2.5:1.5b` and `nomic-embed-text` pulled.

```bash
ollama pull qwen2.5:1.5b
ollama pull nomic-embed-text

pip install -r marihacks/requirements.txt

export MONIKA_VAULT=/path/to/your/obsidian/vault
python -m marihacks.server
```

Open `http://localhost:8765/viz` for the constellation view. Or install the Obsidian plugin from `marihacks/plugin/` and talk to Monika inside your editor.

Zero-setup demo: open `marihacks/constellation.html` directly in a browser. It replays a captured event stream with no backend needed.

## Icarus v2, the hardware tease

The final form is not software alone. Icarus v2 is a modular PCB companion device built around an ESP32-S3 with an e-ink face, capacitive touch, a 3-axis IMU for gesture input, and a magnetic pogo-pin dock. It talks to the Monika server over local WiFi. The e-ink shows whatever constellation is active, the touch zones map to agent handoffs, and the gesture IMU lets you dismiss emotion tags with a flick.

The modular part is the point. Each subsystem is a pluggable board that snaps onto the spine via the same pogo connector. Want a bigger screen, swap the face board. Want a microphone array, slot a mic board into any open port. The schematics and KiCad files live in a separate repo. Hardware target is Stasis, May 2026.

## Team

One coder, a support crew, and a lot of vibes. The rest of the team handles the presentation, the demo narrative, and the coolness factor. The constellations are for them as much as the judges.

---

Built in Montreal for MariHacks 2026.

Runs offline. Remembers you. Narrates its own thinking. Your data never leaves your machine.

See `marihacks/README.md` for deeper technical docs and `TEAMMATE_GUIDE.md` for the web UI contract.
