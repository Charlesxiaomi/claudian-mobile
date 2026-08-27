import { AbstractInputSuggest, App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem, TextComponent } from "obsidian";

import { DEFAULT_BASE_URL, fetchModels, testConnection } from "@/core/AnthropicClient";
import type { AgentSettings, EffortLevel } from "@/core/types";
import { EFFORT_LEVELS } from "@/core/types";
import type { FeishuService } from "@/feishu/FeishuService";
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
  feishu: null,
};

export interface SettingsHost {
  settings: AgentSettings;
  feishu: FeishuService;
  saveSettings(): Promise<void>;
  /** Lets the plugin re-label anything already on screen after a language switch. */
  onLanguageChanged?(): void;
}

export class ClaudianMobileSettingsTab extends PluginSettingTab {
  // Typed as SettingsHost (not Plugin & SettingsHost) so member accesses
  // resolve to our own interface: on `Plugin`, `settings` is an Obsidian
  // 1.13+ API and would break the declared minAppVersion.
  private readonly host: SettingsHost;

  constructor(app: App, host: Plugin & SettingsHost) {
    super(app, host);
    this.host = host;
  }

  /** Calls SettingTab.update() where it exists (1.13+); older apps redraw via display(). */
  private requestUpdate(): void {
    const tab = this as unknown as Partial<{ update(): void }>;
    if (typeof tab.update === "function") tab.update();
    else this.display();
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
        // Rendered imperatively to attach the model-id suggestion popover.
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
      {
        // Static desc keeps the entry findable via settings search; the
        // render callback swaps in the live connection status.
        name: s.feishu,
        desc: s.feishuDescDisconnected,
        render: (setting: Setting) => this.configureFeishuSetting(setting),
      },
      {
        name: s.language,
        desc: s.languageDesc,
        control: { type: "dropdown", key: "language", options: languageOptions },
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
        this.requestUpdate();
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

  /** Model-id input with suggestion popover, shared by both rendering paths. */
  private configureModelText(text: TextComponent): void {
    // An Obsidian suggestion popover anchored to the input, instead of a
    // native <datalist>: Android renders datalist options in a system strip
    // above the keyboard, far away from the field.
    const suggest = new ModelSuggest(this.app, text.inputEl, () => this.host.settings.modelOptions);
    suggest.onSelect(async (value) => {
      text.setValue(value);
      this.host.settings.model = value;
      await this.host.saveSettings();
      suggest.close();
    });

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

  /**
   * Feishu connection row: status in the description, a Connect button that
   * runs the whole registration + device-code flow (two browser confirms),
   * or a Disconnect button when a session exists.
   */
  private configureFeishuSetting(setting: Setting): void {
    const s = t().settings;
    const feishu = this.host.feishu;
    setting.setDesc(feishu.isConnected() ? s.feishuDescConnected(feishu.connectedUserName()) : s.feishuDescDisconnected);
    if (feishu.isConnected()) {
      setting.addButton((button) => {
        button.setButtonText(s.feishuDisconnectButton).onClick(async () => {
          await feishu.disconnect();
          new Notice(s.feishuDisconnected);
          this.refresh();
        });
      });
      return;
    }
    setting.addButton((button) => {
      button
        .setCta()
        .setButtonText(s.feishuConnectButton)
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await feishu.connect({
              openUrl: (url) => {
                window.open(url);
              },
              // Long-lived notices: the user is being bounced to a browser
              // and needs the hint to still be there when they come back.
              onStage: (stage) => new Notice(stage === "registering" ? s.feishuStageRegistering : s.feishuStageAuthorizing, 15000),
            });
            new Notice(s.feishuConnected(feishu.connectedUserName()));
          } catch (err) {
            new Notice(s.feishuConnectFailed(err instanceof Error ? err.message : String(err)));
          } finally {
            button.setDisabled(false);
            this.refresh();
          }
        });
    });
  }

  /** Redraws whichever rendering path is active. */
  private refresh(): void {
    if (this.usingFallback) this.display();
    else this.requestUpdate();
  }

  private usingFallback = false;

  /** Imperative fallback for Obsidian versions older than 1.13. */
  display(): void {
    this.usingFallback = true;
    const { containerEl } = this;
    containerEl.empty();
    const s = t().settings;

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

    new Setting(containerEl).setName(s.feishu).then((setting) => this.configureFeishuSetting(setting));

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
          // Redraw so every label picks up the new locale.
          this.display();
        });
      });
  }
}

/**
 * Model-id suggestions anchored to the input as an Obsidian popover.
 * Reads options lazily so Model-list edits or a fetch show up without
 * reopening the settings tab.
 */
class ModelSuggest extends AbstractInputSuggest<string> {
  private readonly getOptions: () => string[];

  constructor(app: App, inputEl: HTMLInputElement, getOptions: () => string[]) {
    super(app, inputEl);
    this.getOptions = getOptions;
  }

  protected getSuggestions(query: string): string[] {
    const options = this.getOptions();
    const q = query.trim().toLowerCase();
    // An untouched saved value would filter the list down to itself, which
    // hides the alternatives — show everything until the user starts editing.
    if (!q || options.some((m) => m.toLowerCase() === q)) return options;
    return options.filter((m) => m.toLowerCase().includes(q));
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
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
