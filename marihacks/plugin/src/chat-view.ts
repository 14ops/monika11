import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type MonikaPlugin from "./main";

export const CHAT_VIEW_TYPE = "monika-chat-view";

interface ChatTurn {
  role: "user" | "monika";
  text: string;
  meta?: string;
}

export class MonikaChatView extends ItemView {
  private log: ChatTurn[] = [];
  private logEl!: HTMLDivElement;
  private inputEl!: HTMLInputElement;
  private sendBtn!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, private plugin: MonikaPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Monika";
  }

  getIcon(): string {
    return "sparkles";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("monika-chat-pane");

    this.logEl = root.createDiv({ cls: "monika-chat-log" });

    const row = root.createDiv({ cls: "monika-chat-input-row" });
    this.inputEl = row.createEl("input", {
      type: "text",
      placeholder: "Ask Monika... but show your work.",
      cls: "monika-chat-input",
    });
    this.sendBtn = row.createEl("button", {
      text: "Send",
      cls: "monika-chat-send",
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
    this.sendBtn.addEventListener("click", () => this.send());

    this.greet();
  }

  private greet(): void {
    this.pushTurn({
      role: "monika",
      text:
        "Hey. I am Monika. I will not hand you answers. Tell me what you already tried, and I will help you think sharper.",
    });
  }

  private pushTurn(turn: ChatTurn): void {
    this.log.push(turn);
    const row = this.logEl.createDiv({
      cls: `monika-chat-row monika-chat-${turn.role}`,
    });
    row.createDiv({
      cls: "monika-chat-role",
      text: turn.role === "user" ? "You" : "Monika",
    });
    row.createDiv({ cls: "monika-chat-body", text: turn.text });
    if (turn.meta) {
      row.createDiv({ cls: "monika-chat-meta", text: turn.meta });
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  askFromOutside(text: string): void {
    this.inputEl.value = text;
    this.send();
  }

  private async send(): Promise<void> {
    const message = this.inputEl.value.trim();
    if (!message) return;
    this.inputEl.value = "";
    this.sendBtn.disabled = true;
    this.pushTurn({ role: "user", text: message });

    try {
      const resp = await this.plugin.chat(message);
      const meta = `effort ${resp.effort_score}/10 · ${resp.emotion} · ${Math.round(
        resp.latency_ms
      )}ms`;
      this.pushTurn({ role: "monika", text: resp.text, meta });
    } catch (e) {
      new Notice(`Monika error: ${(e as Error).message}`);
      this.pushTurn({
        role: "monika",
        text: "The swarm is offline. Start the server with: uvicorn marihacks.server:app --port 8787",
      });
    } finally {
      this.sendBtn.disabled = false;
      this.inputEl.focus();
    }
  }
}
