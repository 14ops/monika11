import { App, PluginSettingTab, Setting } from "obsidian";
import type MonikaPlugin from "./main";

export interface MonikaSettings {
  serverUrl: string;   // http(s)://host:port
  wsUrl: string;       // ws(s)://host:port/ws
  vaultPathOverride: string; // optional, sent to server on startup
  autoSyncVault: boolean;    // POST /vault/path on plugin load
}

export const DEFAULT_SETTINGS: MonikaSettings = {
  serverUrl: "http://127.0.0.1:8787",
  wsUrl: "ws://127.0.0.1:8787/ws",
  vaultPathOverride: "",
  autoSyncVault: true,
};

export class MonikaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MonikaPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Monika Constellation" });

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc("HTTP base of the Monika FastAPI server.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (v) => {
            this.plugin.settings.serverUrl = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("WebSocket URL")
      .setDesc("ws:// endpoint used by the constellation view.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.wsUrl)
          .onChange(async (v) => {
            this.plugin.settings.wsUrl = v.trim();
            await this.plugin.saveSettings();
            this.plugin.bus.setUrl(this.plugin.settings.wsUrl);
          })
      );

    new Setting(containerEl)
      .setName("Vault path override")
      .setDesc("Absolute path sent to the server. Leave blank to auto-detect.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.vaultPathOverride)
          .onChange(async (v) => {
            this.plugin.settings.vaultPathOverride = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-sync vault on load")
      .setDesc("POST the vault path to /vault/path when the plugin starts.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.autoSyncVault)
          .onChange(async (v) => {
            this.plugin.settings.autoSyncVault = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reindex vault now")
      .setDesc("Trigger a full reindex on the server.")
      .addButton((btn) =>
        btn.setButtonText("Reindex").onClick(async () => {
          await this.plugin.reindexVault();
        })
      );
  }
}
