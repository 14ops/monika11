import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { MonikaBus } from "./bus";
import {
  MonikaSettings,
  MonikaSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";
import { CHAT_VIEW_TYPE, MonikaChatView } from "./chat-view";
import {
  CONSTELLATION_VIEW_TYPE,
  MonikaConstellationView,
} from "./constellation-view";

export default class MonikaPlugin extends Plugin {
  settings!: MonikaSettings;
  bus!: MonikaBus;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.bus = new MonikaBus(this.settings.wsUrl);
    this.bus.start();

    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MonikaChatView(leaf, this)
    );
    this.registerView(
      CONSTELLATION_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MonikaConstellationView(leaf, this)
    );

    this.addRibbonIcon("sparkles", "Open Monika chat", () => {
      this.activateView(CHAT_VIEW_TYPE, "right");
    });
    this.addRibbonIcon("star", "Open Monika constellation", () => {
      this.activateView(CONSTELLATION_VIEW_TYPE, "right");
    });

    this.addCommand({
      id: "open-monika-chat",
      name: "Open Monika chat",
      callback: () => this.activateView(CHAT_VIEW_TYPE, "right"),
    });
    this.addCommand({
      id: "open-monika-constellation",
      name: "Open constellation view",
      callback: () => this.activateView(CONSTELLATION_VIEW_TYPE, "right"),
    });
    this.addCommand({
      id: "ask-monika-about-current-note",
      name: "Ask Monika about current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return true;
        this.askAboutFile(file);
        return true;
      },
    });
    this.addCommand({
      id: "reindex-vault",
      name: "Reindex vault in Monika memory",
      callback: () => this.reindexVault(),
    });

    this.addSettingTab(new MonikaSettingTab(this.app, this));

    if (this.settings.autoSyncVault) {
      // Let Obsidian finish loading before we hit the server.
      this.app.workspace.onLayoutReady(() => this.syncVaultPath());
    }
  }

  async onunload(): Promise<void> {
    this.bus.stop();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(type: string, side: "right" | "left"): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(type)[0];
    if (!leaf) {
      leaf =
        side === "right"
          ? workspace.getRightLeaf(false) ?? workspace.getLeaf(true)
          : workspace.getLeftLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async chat(message: string): Promise<{
    text: string;
    effort_score: number;
    emotion: string;
    emotion_confidence: number;
    tokens_used: number;
    latency_ms: number;
  }> {
    const url = `${this.settings.serverUrl.replace(/\/$/, "")}/chat`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      throw new Error(`server ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  private resolveVaultPath(): string | null {
    if (this.settings.vaultPathOverride) return this.settings.vaultPathOverride;
    // @ts-ignore — Obsidian exposes getBasePath() on FileSystemAdapter at runtime
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    if (adapter.getBasePath) return adapter.getBasePath();
    return null;
  }

  async syncVaultPath(): Promise<void> {
    const path = this.resolveVaultPath();
    if (!path) return;
    const url = `${this.settings.serverUrl.replace(/\/$/, "")}/vault/path`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        const data = (await res.json()) as { chunks?: number };
        new Notice(`Monika indexed ${data.chunks ?? 0} chunks`);
      }
    } catch {
      new Notice("Monika server offline; chat will still try to connect.");
    }
  }

  async reindexVault(): Promise<void> {
    const url = `${this.settings.serverUrl.replace(/\/$/, "")}/vault/reindex`;
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { chunks?: number };
      new Notice(`Reindexed ${data.chunks ?? 0} chunks`);
    } catch (e) {
      new Notice(`Reindex failed: ${(e as Error).message}`);
    }
  }

  private async askAboutFile(file: TFile): Promise<void> {
    const text = await this.app.vault.read(file);
    const excerpt = text.length > 600 ? text.slice(0, 600) + "…" : text;
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (leaves.length === 0) {
      await this.activateView(CHAT_VIEW_TYPE, "right");
    }
    const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]
      ?.view as MonikaChatView | undefined;
    chatView?.askFromOutside(
      `I have been reading ${file.basename}. Here is the part I am stuck on:\n\n${excerpt}\n\nWhat should I think about first?`
    );
  }
}
