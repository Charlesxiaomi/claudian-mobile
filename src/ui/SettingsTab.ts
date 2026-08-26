import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem, TextComponent } from "obsidian";

import { DEFAULT_BASE_URL, fetchModels, testConnection } from "@/core/AnthropicClient";
import type { AgentSettings, EffortLevel } from "@/core/types";
import { EFFORT_LEVELS } from "@/core/types";
import { LANGUAGE_NAMES, LANGUAGE_SETTINGS, setLanguage, t } from "@/i18n";
import type { LanguageSetting } from "@/i18n";
import { ModelTestModal } from "@/ui/ModelTestModal";

/** Seeds modelOptions on first run; the UI reads settings.modelOptions, not this. */
export const MODEL_SUGGESTIONS = ["deepseek-chat", "deepseek-reasoner", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"];

export const DEFAULT_SETTINGS: AgentSettings = {
  language: "auto",
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  model: "deepseek-chat",
  modelOptions: [...MODEL_SUGGESTIONS],
  effort: "high",
  maxOutputTokens: 4096,
  maxIterations: 25,
  systemPrompt:
    "You are a helpful writing and knowledge assistant embedded in the user's Obsidian vault. " +
    "Use the provided tools to read, search, create, and edit notes on the user's behalf. " +
    "Prefer patch_note for small edits and write_note only when replacing a note's full content. " +
    "Reply in the language the user writes in.",
  chatZoom: 1,
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
        name: s.fetchModels,
        desc: s.fetchModelsDesc,
        render: (setting: Setting) => this.configureFetchModelsButton(setting),
      },
      {
        name: s.testConnection,
        desc: s.testConnectionDesc,
        render: (setting: Setting) => this.configureTestButton(setting),
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
      .setPlaceholder("sk-...")
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
    const populate = () => {
      datalist.empty();
      for (const model of this.host.settings.modelOptions) {
        datalist.createEl("option", { attr: { value: model } });
      }
    };
    populate();
    // Rebuilt on focus so edits to the Model list (or a fetch) show up
    // without reopening the settings tab.
    text.inputEl.addEventListener("focus", populate);
    text.inputEl.setAttr("list", listId);

    text
      .setPlaceholder("deepseek-chat")
      .setValue(this.host.settings.model)
      .onChange(async (value) => {
        this.host.settings.model = value.trim();
        await this.host.saveSettings();
      });
  }

  /**
   * "Fetch model list" button: merges the endpoint's /v1/models ids into
   * modelOptions. Merge only — user-entered ids are never removed, since an
   * id the endpoint doesn't advertise may still work (see testConnection).
   */
  private configureFetchModelsButton(setting: Setting): void {
    setting.addButton((button) => {
      button.setButtonText(t().settings.fetchModelsButton).onClick(async () => {
        const settings = this.host.settings;
        if (!settings.apiKey) {
          new Notice(t().chat.missingApiKey);
          return;
        }
        button.setDisabled(true).setButtonText(t().settings.fetchModelsFetching);
        try {
          const ids = await fetchModels({ apiKey: settings.apiKey, baseUrl: settings.baseUrl });
          const before = settings.modelOptions.length;
          settings.modelOptions = mergeModelOptions(settings.modelOptions, ids);
          await this.host.saveSettings();
          new Notice(t().settings.fetchModelsResult(settings.modelOptions.length - before, ids.length));
          // Redraw so the Model list textarea shows the merged ids.
          this.refresh();
        } catch (err) {
          new Notice(t().settings.fetchModelsFailed(err instanceof Error ? err.message : String(err)));
        } finally {
          button.setDisabled(false).setButtonText(t().settings.fetchModelsButton);
        }
      });
    });
  }

  /** "Test connection" button: picks a model, then really streams a "hi". */
  private configureTestButton(setting: Setting): void {
    setting.addButton((button) => {
      button.setButtonText(t().settings.testConnectionButton).onClick(() => {
        const settings = this.host.settings;
        if (!settings.apiKey) {
          new Notice(t().chat.missingApiKey);
          return;
        }
        const current = settings.model.trim();
        const models = mergeModelOptions(current ? [current] : [], settings.modelOptions);
        if (models.length === 0) {
          new Notice(t().chat.modelUnset);
          return;
        }
        new ModelTestModal(this.app, models, (model) =>
          testConnection({
            apiKey: settings.apiKey,
            baseUrl: settings.baseUrl,
            model,
            effort: settings.effort,
          }),
        ).open();
      });
    });
  }

  /** Redraws whichever rendering path is active. */
  private refresh(): void {
    if (this.usingFallback) this.display();
    else this.update();
  }

  private usingFallback = false;

  /** Imperative fallback for Obsidian versions older than 1.13. */
  display(): void {
    this.usingFallback = true;
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
      .setName(s.fetchModels)
      .setDesc(s.fetchModelsDesc)
      .then((setting) => this.configureFetchModelsButton(setting));

    new Setting(containerEl)
      .setName(s.testConnection)
      .setDesc(s.testConnectionDesc)
      .then((setting) => this.configureTestButton(setting));

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

/** Appends ids from `fetched` that aren't already in `existing`; never removes. */
export function mergeModelOptions(existing: string[], fetched: string[]): string[] {
  const seen = new Set(existing);
  const merged = [...existing];
  for (const id of fetched) {
    const trimmed = id.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }
  return merged;
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
