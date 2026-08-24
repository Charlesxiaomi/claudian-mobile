import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

import { DEFAULT_BASE_URL } from "@/core/AnthropicClient";
import type { AgentSettings } from "@/core/types";
import { LANGUAGE_NAMES, LANGUAGE_SETTINGS, setLanguage, t } from "@/i18n";
import type { LanguageSetting } from "@/i18n";

export const DEFAULT_SETTINGS: AgentSettings = {
  language: "auto",
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  model: "claude-sonnet-5",
  maxOutputTokens: 4096,
  maxIterations: 25,
  systemPrompt:
    "You are a helpful writing and knowledge assistant embedded in the user's Obsidian vault. " +
    "Use the provided tools to read, search, create, and edit notes on the user's behalf. " +
    "Prefer patch_note for small edits and write_note only when replacing a note's full content. " +
    "Reply in the language the user writes in.",
};

const MODEL_SUGGESTIONS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"];

export interface SettingsHost {
  settings: AgentSettings;
  saveSettings(): Promise<void>;
  /** Lets the plugin re-label anything already on screen after a language switch. */
  onLanguageChanged?(): void;
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
    const s = t().settings;

    new Setting(containerEl)
      .setName(s.language)
      .setDesc(s.languageDesc)
      .addDropdown((dropdown) => {
        for (const value of LANGUAGE_SETTINGS) {
          dropdown.addOption(value, value === "auto" ? s.languageAuto : LANGUAGE_NAMES[value]);
        }
        dropdown.setValue(this.host.settings.language).onChange(async (value) => {
          this.host.settings.language = value as LanguageSetting;
          setLanguage(this.host.settings.language);
          await this.host.saveSettings();
          this.host.onLanguageChanged?.();
          // Redraw so every label below picks up the new locale.
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(s.apiKey)
      .setDesc(s.apiKeyDesc)
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
      .setName(s.baseUrl)
      .setDesc(s.baseUrlDesc(DEFAULT_BASE_URL))
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
      .setName(s.model)
      .setDesc(s.modelDesc)
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
      .setName(s.maxOutputTokens)
      .setDesc(s.maxOutputTokensDesc)
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
      .setName(s.maxIterations)
      .setDesc(s.maxIterationsDesc)
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

    new Setting(containerEl).setName(s.systemPrompt).addTextArea((text) => {
      text.inputEl.rows = 6;
      text.setValue(this.host.settings.systemPrompt).onChange(async (value) => {
        this.host.settings.systemPrompt = value;
        await this.host.saveSettings();
      });
    });
  }
}
