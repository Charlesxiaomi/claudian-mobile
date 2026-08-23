import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

import { DEFAULT_BASE_URL } from "@/core/AnthropicClient";
import type { AgentSettings } from "@/core/types";

export const DEFAULT_SETTINGS: AgentSettings = {
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  model: "claude-sonnet-5",
  maxOutputTokens: 4096,
  maxIterations: 25,
  systemPrompt:
    "You are a helpful writing and knowledge assistant embedded in the user's Obsidian vault. " +
    "Use the provided tools to read, search, create, and edit notes on the user's behalf. " +
    "Prefer patch_note for small edits and write_note only when replacing a note's full content.",
};

const MODEL_SUGGESTIONS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"];

export interface SettingsHost {
  settings: AgentSettings;
  saveSettings(): Promise<void>;
}

export class ClaudianMobileSettingsTab extends PluginSettingTab {
  private readonly host: Plugin & SettingsHost;

  constructor(app: App, host: Plugin & SettingsHost) {
    super(app, host);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc(
        "Stored in plaintext in this device's vault config (.obsidian/plugins/claudian-mobile/data.json). " +
          "Do not use a key you aren't comfortable having on this device, especially if the vault is synced.",
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.host.settings.apiKey)
          .onChange(async (value) => {
            this.host.settings.apiKey = value.trim();
            await this.host.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc(
        "The Anthropic Messages API endpoint to call. Change this to point at a third-party or self-hosted " +
          `gateway that implements the same /v1/messages streaming API (e.g. Kimi, GLM, or a proxy). ` +
          `Default: ${DEFAULT_BASE_URL}`,
      )
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_BASE_URL)
          .setValue(this.host.settings.baseUrl)
          .onChange(async (value) => {
            this.host.settings.baseUrl = value.trim() || DEFAULT_BASE_URL;
            await this.host.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("The model id sent to the API above. Third-party endpoints often use their own model names.")
      .addText((text) => {
        const listId = "claudian-mobile-model-suggestions";
        const datalist = text.inputEl.ownerDocument.createElement("datalist");
        datalist.id = listId;
        for (const model of MODEL_SUGGESTIONS) {
          const option = text.inputEl.ownerDocument.createElement("option");
          option.value = model;
          datalist.appendChild(option);
        }
        text.inputEl.after(datalist);
        text.inputEl.setAttr("list", listId);

        text
          .setPlaceholder("claude-sonnet-5")
          .setValue(this.host.settings.model)
          .onChange(async (value) => {
            this.host.settings.model = value.trim();
            await this.host.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Max output tokens")
      .setDesc("Upper bound on tokens the model can generate per turn.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(this.host.settings.maxOutputTokens)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) {
            this.host.settings.maxOutputTokens = Math.floor(n);
            await this.host.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Max tool-use iterations")
      .setDesc("Safety cap on how many tool-call round-trips a single reply can make.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(this.host.settings.maxIterations)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) {
            this.host.settings.maxIterations = Math.floor(n);
            await this.host.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("System prompt")
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.setValue(this.host.settings.systemPrompt).onChange(async (value) => {
          this.host.settings.systemPrompt = value;
          await this.host.saveSettings();
        });
      });
  }
}
