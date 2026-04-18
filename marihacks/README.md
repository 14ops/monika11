# MariHacks: Monika + Obsidian Constellation

A 24-hour cut of the Just Monika swarm built for MariHacks. Three judge-visible surfaces:

1. A FastAPI + WebSocket server that wraps the existing `monika/` agent swarm and emits live events every time an agent activates, hands off, or pulls from memory.
2. An Obsidian plugin with two views: a chat pane where Monika refuses to do your homework, and a constellation canvas that renders the agent swarm as named star-clusters with particle flow on every handoff.
3. A ChromaDB-backed vault indexer that watches the active Obsidian vault and auto-reindexes on every edit.

Hits all three MariHacks tracks with one project: single-agent tool use, real-world API integration, and multi-agent coordination.

---

## Quick start (Python backend)

Prereqs: Ollama running locally with the models pulled.

```bash
# from the repo root
ollama pull llama3.1:8b
ollama pull phi3:mini
ollama pull nomic-embed-text

python -m venv .venv
. .venv/bin/activate           # on Windows: .venv\Scripts\activate
pip install -e .
pip install -r marihacks/requirements.txt

# optional: point at your Obsidian vault
export MONIKA_VAULT_PATH="$HOME/Documents/my-vault"

uvicorn marihacks.server:app --host 127.0.0.1 --port 8787
```

Verify:

```bash
curl http://127.0.0.1:8787/status
curl http://127.0.0.1:8787/agentic-age
curl -X POST http://127.0.0.1:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"just give me the answer to the coin change problem"}'
```

You should see Monika refuse and the reasoning validator score return low.

To force the full MariHacks brief in chat:

```bash
curl -X POST http://127.0.0.1:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"show me The Agentic Age brief"}'
```

## Quick start (Obsidian plugin)

```bash
cd marihacks/plugin
npm install
npm run build         # outputs main.js in the plugin folder

# Link into your vault:
#   <your-vault>/.obsidian/plugins/monika-constellation/
# Copy: manifest.json, main.js, styles.css
```

Then:

1. Open Obsidian settings, enable Community Plugins, enable "Monika Constellation".
2. In plugin settings, confirm the server URL (`http://127.0.0.1:8787`) and WebSocket URL (`ws://127.0.0.1:8787/ws`).
3. Click the sparkle icon in the ribbon for chat. Click the star icon for the constellation view.
4. Ask a question. Watch the constellations pulse, arcs light up, and the memory galaxy flare when Monika pulls from your notes.

## Architecture

```
Obsidian plugin           FastAPI server                Monika swarm
────────────────          ──────────────                ────────────
 chat pane ─────────▶  POST /chat ───────▶  MonikaPipeline.arespond
 constellation   ◀── WebSocket /ws  ◀──  EventEmittingTracer
                      vault indexer (watchdog) ─▶  MemoryManager (ChromaDB)
```

Event types over the WebSocket:

- `user_message`, `pipeline_start`, `pipeline_end`, `pipeline_error`
- `agent_start`, `agent_complete`, `handoff`, `tool_call`
- `memory_hit`, `vault_indexed`, `vault_upsert`, `vault_deleted`
- `assistant_message`

The plugin maps each event to a visual effect on the canvas: constellation pulse, arc draw, particle spawn, or memory-galaxy flare.

## Demo script

Scene 1: lazy ask. "Give me the coin change solution." Effort score drops, persona refuses, constellation fires the reasoning arc hard.

Scene 2: real effort. "I tried memoizing coin change but I keep double-counting. I looped coins in the inner loop." Effort score climbs, emotion classifier flags `confused`, memory galaxy lights up the `Study log` and `Recursion` notes, Monika asks a Socratic follow-up grounded in the user's own writing.

Scene 3: full swarm. Ask again with tight evidence. Persona gives a surgical hint. All four constellations pulse in sync, arcs form a closed loop.

## File layout

```
marihacks/
├── __init__.py
├── events.py              # async EventBus (fan-out pub/sub)
├── event_tracer.py        # Tracer subclass that broadcasts span lifecycle
├── server.py              # FastAPI + WebSocket app
├── vault.py               # Obsidian vault indexer (watchdog-backed)
├── requirements.txt
├── demo_vault/            # seed notes for testing
└── plugin/
    ├── manifest.json
    ├── package.json
    ├── esbuild.config.mjs
    ├── tsconfig.json
    ├── styles.css
    └── src/
        ├── main.ts               # plugin entry + command palette
        ├── settings.ts           # server URL, vault sync
        ├── bus.ts                # WebSocket client with reconnect
        ├── chat-view.ts          # chat pane
        ├── constellation-view.ts # canvas pane
        └── constellation/
            ├── scene.ts          # star layouts + types
            └── render.ts         # canvas draw loop
```

## Cuts if the clock runs out

- Skip `autoSyncVault`, point the plugin at a hardcoded vault path.
- Drop the emotion classifier arc; two-agent demo still reads well.
- If Ollama is fl