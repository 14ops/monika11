import { ItemView, WorkspaceLeaf } from "obsidian";
import type MonikaPlugin from "./main";
import { MonikaEvent } from "./bus";
import {
  AgentId,
  buildInitialScene,
  mapAgentId,
  SceneState,
} from "./constellation/scene";
import {
  addArc,
  addMemoryHit,
  decayScene,
  pulseAgent,
  renderScene,
} from "./constellation/render";

export const CONSTELLATION_VIEW_TYPE = "monika-constellation-view";

export class MonikaConstellationView extends ItemView {
  private canvas!: HTMLCanvasElement;
  private status!: HTMLDivElement;
  private scene: SceneState = buildInitialScene();
  private raf = 0;
  private lastFrame = 0;
  private unsubBus: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: MonikaPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return CONSTELLATION_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Monika Constellation";
  }

  getIcon(): string {
    return "star";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("monika-constellation-pane");

    this.canvas = root.createEl("canvas", {
      cls: "monika-constellation-canvas",
    });
    this.status = root.createDiv({
      cls: "monika-constellation-status",
      text: "waiting for agent activity…",
    });

    this.unsubBus = this.plugin.bus.on((ev) => this.onEvent(ev));
    this.scheduleResize();
    this.loop();
  }

  async onClose(): Promise<void> {
    if (this.unsubBus) this.unsubBus();
    cancelAnimationFrame(this.raf);
  }

  private scheduleResize(): void {
    const resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = this.canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(this.canvas);
    this.register(() => ro.disconnect());
  }

  private loop = (): void => {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(60, now - this.lastFrame) : 16;
    this.lastFrame = now;

    decayScene(this.scene, dt);
    renderScene(
      {
        ctx,
        w: this.canvas.clientWidth,
        h: this.canvas.clientHeight,
        scale: Math.min(this.canvas.clientWidth, this.canvas.clientHeight),
        now: Date.now(),
        dt,
      },
      this.scene
    );

    this.raf = requestAnimationFrame(this.loop);
  };

  private onEvent(ev: MonikaEvent): void {
    switch (ev.type) {
      case "connected":
        this.status.setText("connected");
        break;
      case "ws_open":
        this.status.setText("connected");
        break;
      case "ws_close":
        this.status.setText("disconnected, retrying…");
        break;
      case "user_message": {
        pulseAgent(this.scene, "user", 1);
        addArc(this.scene, "user", "reasoning_validator");
        addArc(this.scene, "user", "emotion_classifier");
        this.status.setText("you → swarm");
        break;
      }
      case "pipeline_start":
        this.status.setText("swarm thinking…");
        break;
      case "agent_start": {
        const agent = mapAgentId(ev.agent as string | undefined);
        pulseAgent(this.scene, agent, 0.85);
        break;
      }
      case "agent_complete": {
        const agent = mapAgentId(ev.agent as string | undefined);
        pulseAgent(this.scene, agent, 0.5);
        // reasoning/emotion feed into persona
        if (agent === "reasoning_validator" || agent === "emotion_classifier") {
          addArc(this.scene, agent, "monika_persona");
        }
        break;
      }
      case "handoff": {
        const from = mapAgentId(ev.from as string | undefined);
        const to = mapAgentId(ev.to as string | undefined);
        addArc(this.scene, from, to);
        break;
      }
      case "memory_hit": {
        const title = String(ev.title ?? ev.id ?? "note");
        addMemoryHit(this.scene, title);
        addArc(this.scene, "memory", "monika_persona");
        this.status.setText(`recalled: ${title}`);
        break;
      }
      case "assistant_message": {
        pulseAgent(this.scene, "monika_persona", 1);
        addArc(this.scene, "monika_persona", "user");
        this.status.setText(
          `effort ${ev.effort_score ?? "?"}/10 · ${ev.emotion ?? "?"}`
        );
        break;
      }
      case "pipeline_end":
        this.status.setText("idle");
        break;
      case "vault_indexed":
        this.status.setText(`vault indexed: ${ev.chunks} chunks`);
        break;
      case "vault_upsert":
        this.status.setText(`updated: ${ev.path}`);
        break;
      case "tool_call":
        pulseAgent(this.scene, "monika_persona", 0.6);
        break;
      case "pipeline_error":
        this.status.setText(`error: ${ev.error}`);
        break;
    }
  }
}
