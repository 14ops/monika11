# Teammate guide, zero coding required

You are building the web UI for Just Monika. You do not need to touch Python. You just need to talk to the backend Seth already built.

## What Just Monika is in plain words

A local AI companion with 5 agents working together. You ask it something, and behind the scenes multiple AI brains talk to each other and pull stuff from the user's notes before answering. Your UI shows that happening live.

The 5 agents:

- `user`, the human asking the question
- `reasoning_validator`, checks if the question is clear
- `emotion_classifier`, guesses how the user feels
- `memory`, fetches relevant notes from the user's Obsidian vault
- `monika_persona`, the main AI that writes the final reply
- `fact_extractor`, silently saves facts from the chat for next time

## What your UI should do

Three jobs.

1. A chat box where the user types a message and sees the reply
2. A live visualization that animates while the agents are thinking, showing who is talking to who
3. A side panel showing which memories got pulled and which agent is active

Think of it like a group chat where you can see who is typing, except the typers are AI agents.

## How to run the backend to test against

Seth handles this. If you want to run it yourself on your machine:

```
pip install -r marihacks/requirements.txt
python -m marihacks.server
```

The server runs at `http://localhost:8765`.

## The two ways to talk to the backend

### 1. Send a chat message, REST

POST to `http://localhost:8765/chat` with JSON body:

```json
{ "message": "explain the coin change problem" }
```

You get back the final text reply.

### 2. Watch the agents work, WebSocket

Open a WebSocket to `ws://localhost:8765/ws`. Every time something happens you get a JSON message. Example events:

```json
{ "type": "agent_start", "agent": "reasoning_validator" }
{ "type": "agent_end", "agent": "reasoning_validator", "duration_ms": 21200, "tokens": 33 }
{ "type": "memory_hit", "title": "Where I am stuck", "distance": 0.28 }
{ "type": "handoff", "from": "user", "to": "monika_persona" }
{ "type": "token", "agent": "monika_persona", "text": "To solve coin change" }
{ "type": "final", "text": "full reply text here" }
```

Your UI listens to these and animates accordingly.

## If you are using an AI site builder, v0, Lovable, Cursor, Bolt

Paste this prompt to get started:

> Build a dark-themed single-page chat UI with a canvas visualization in the middle. On the left side, show a list of 5 AI agents: user, reasoning_validator, emotion_classifier, memory, monika_persona. On the right, show a memory hits panel. The chat input is at the bottom. When the user sends a message, open a WebSocket to ws://localhost:8765/ws and display incoming events: agent_start should pulse the agent's card, handoff should draw a line between agents, memory_hit should add a card to the memory panel, token events build up the reply bubble, final ends the turn. Also POST the message to http://localhost:8765/chat. Use Tailwind. Make the visualization look like a constellation with glowing stars for agents and animated particles flowing between them on handoffs.

## Reference design

Seth already built a standalone version in `marihacks/constellation.html`. Open it in a browser to see the look you are matching. It replays a captured conversation so you can study the animations. Steal anything you want from that file.

## Colors to match

- background `#05050d`
- user `#5de3ff`
- reasoning_validator `#ff6b5c`
- emotion_classifier `#ff74d2`
- monika_persona `#ffd36b`
- memory `#b58cff`
- fact_extractor `#8cbcff`
- text on dark `#e6ecff`
- muted text `#9aa8d4`

## How to push your changes back to the repo

If you are using GitHub Desktop:

1. Install https://desktop.github.com
2. Sign in
3. File menu, "Clone repository", pick `14ops/marihacks-monika`
4. Put your code inside a new folder called `webui/` in the repo
5. Bottom left, write a commit message, click "Commit to main"
6. Top bar, click "Push origin"

If you built your site in a no-code tool like v0 or Lovable, export the code, drop the files into the `webui/` folder, then do steps 5 and 6.

## What counts as done

Three checks:

1. User can type a message, see a reply come back
2. While the reply is generating, at least one visual thing changes, a pulse, a line, a color shift
3. When memories get pulled, the user sees what they were

Ship those three, anything beyond is bonus.

## Questions

Ping Seth. If he is sleeping, open `marihacks/constellation.html` and copy whatever is in there.
