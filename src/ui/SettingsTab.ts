import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem, TextComponent } from "obsidian";

import { DEFAULT_BASE_URL } from "@/core/AnthropicClient";
import type { AgentSettings, EffortLevel } from "@/core/types";
import { EFFORT_LEVELS } from "@/core/types";
import { LANGUAGE_NAMES, LANGUAGE_SETTINGS, setLanguage, t } from "@/i18n";
import type { LanguageSetting } from "@/i18n";

/** Offered by the composer's model button, and as autocomplete on the Model setting. */
export const MODEL_SUGGESTIONS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"];

export const DEFAULT_SETTINGS: AgentSettings = {
  language: "auto",
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  model: "claude-sonnet-5",
  modelOptions: [...MODEL_SUGGESTIONS],
  effort: "high",
  maxOutputTokens: 4096,
  maxIterations: 25,
  systemPrompt:
    "You are a helpful writing and knowledge assistant embedded in the user's Obsidian vault. " +
    "Use the provided tools to read, search, create, and edit notes on the user's behalf. " +
    "Prefer patch_note for small edits and write_note only when replacing a note's full content. " +
    "Reply in the language the user writes in.",
};

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

  /**
   * Declarative settings (Obsidian 1.13+): drives rendering and makes every
   * entry findable through the settings search. Older app versions never
   * call this and fall back to display() below.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = t().settings;
    const languageOptions: Record<string, string> = {};
    for (const value of LANGUAGE_SETTINGS) {
      languageOptions[value] = value === "auto" ? s.languageAuto : LANGUAGE_NAMES[value];
    }
    const effortOptions: Record<string, string> = {};
    for (const level of EFFORT_LEVELS) {
      effortOptions[level] = t().chat.effortNames[level];
    }

    return [
      {
        name: s.language,
        desc: s.languageDesc,
        control: { type: "dropdown", key: "language", options: languageOptions },
      },
      {
        // Rendered imperatively so the input can be a masked password field,
        // which the declarative controls do not offer.
        name: s.apiKey,
        desc: s.apiKeyDesc,
        render: (setting: Setting) => {
          setting.addText((text) => this.configureApiKeyText(text));
        },
      },
      {
        name: s.baseUrl,
        desc: s.baseUrlDesc(DEFAULT_BASE_URL),
        control: { type: "text", key: "baseUrl", placeholder: DEFAULT_BASE_URL },
      },
      {
        // Rendered imperatively to keep the model-id datalist suggestions.
        name: s.model,
        desc: s.modelDesc,
        render: (setting: Setting) => {
          setting.addText((text) => this.configureModelText(text));
        },
      },
      {
        name: s.modelOptions,
        desc: s.modelOptionsDesc,
        control: { type: "textarea", key: "modelOptions", rows: 4 },
      },
      {
        name: s.effort,
        desc: s.effortDesc,
        control: { type: "dropdown", key: "effort", options: effortOptions },
      },
      {
        name: s.maxOutputTokens,
        desc: s.maxOutputTokensDesc,
        control: { type: "number", key: "maxOutputTokens", min: 1, step: 1 },
      },
      {
        name: s.maxIterations,
        desc: s.maxIterationsDesc,
        control: { type: "number", key: "maxIterations", min: 1, step: 1 },
      },
      {
        name: s.systemPrompt,
        control: { type: "textarea", key: "systemPrompt", rows: 6 },
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "modelOptions") return this.host.settings.modelOptions.join("\n");
    return this.host.settings[key as keyof AgentSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.host.settings;
    switch (key) {
      case "language":
        settings.language = value as LanguageSetting;
        setLanguage(settings.language);
        await this.host.saveSettings();
        this.host.onLanguageChanged?.();
        // Re-derive the definitions so every label picks up the new locale.
        this.update();
        return;
      case "baseUrl":
        settings.baseUrl = String(value).trim() || DEFAULT_BASE_URL;
        break;
      case "modelOptions":
        settings.modelOptions = parseModelOptions(String(value));
        break;
      case "effort":
        settings.effort = value as EffortLevel;
        break;
      case "maxOutputTokens": {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return;
        settings.maxOutputTokens = Math.floor(n);
        break;
      }
      case "maxIterations": {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return;
        settings.maxIterations = Math.floor(n);
        break;
      }
      case "systemPrompt":
        settings.systemPrompt = String(value);
        break;
      default:
        return;
    }
    await this.host.saveSettings();
  }

  /** Masked API-key input, shared by both rendering paths. */
  private configureApiKeyText(text: TextComponent): void {
    text.inputEl.type = "password";
    text
      .setPlaceholder("sk-ant-...")
      .setValue(this.host.settings.apiKey)
      .onChange(async (value) => {
        this.host.settings.apiKey = value.trim();
        await this.host.saveSettings();
      });
  }

  /** Model-id input with datalist suggestions, shared by both rendering paths. */
  private configureModelText(text: TextComponent): void {
    const listId = "claudian-mobile-model-suggestions";
    const parent = text.inputEl.parentElement ?? text.inputEl;
    const datalist = parent.createEl("datalist", { attr: { id: listId } });
    for (const model of MODEL_SUGGESTIONS) {
      datalist.createEl("option", { attr: { value: model } });
    }
    text.inputEl.setAttr("list", listId);

    text
      .setPlaceholder("claude-sonnet-5")
      .setValue(this.host.settings.model)
      .onChange(async (value) => {
        this.host.settings.model = value.trim();
        await this.host.saveSettings();
      });
  }

  /** Imperative fallback for Obsidian versions older than 1.13. */
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
      .addText((text) => this.configureApiKeyText(text));

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
      .addText((text) => this.configureModelText(text));

    new Setting(containerEl)
      .setName(s.modelOptions)
      .setDesc(s.modelOptionsDesc)
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text.setValue(this.host.settings.modelOptions.join("\n")).onChange(async (value) => {
          this.host.settings.modelOptions = parseModelOptions(value);
          await this.host.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(s.effort)
      .setDesc(s.effortDesc)
      .addDropdown((dropdown) => {
        for (const level of EFFORT_LEVELS) {
          dropdown.addOption(level, t().chat.effortNames[level]);
        }
        dropdown.setValue(this.host.settings.effort).onChange(async (value) => {
          this.host.settings.effort = value as EffortLevel;
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

/** One model id per line; blank lines and duplicates are dropped. */
export function parseModelOptions(raw: string): string[] {
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) seen.add(trimmed);
  }
  return Array.from(seen);
}
