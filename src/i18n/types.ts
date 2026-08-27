import type { EffortLevel } from "@/core/types";

/** Languages the UI actually ships translations for. */
export type Language = "en" | "zh-cn";

/** What the user picks in settings; "auto" follows Obsidian's own language. */
export type LanguageSetting = "auto" | Language;

/**
 * Every user-facing string in the plugin. Each locale file implements this
 * interface, so a missing or misspelled key is a compile error rather than
 * an `undefined` leaking into the UI.
 *
 * Model-facing text (tool descriptions, tool results, the default system
 * prompt) is deliberately absent: it is sent to the API, not shown to the
 * user, and stays in English so prompting behaves the same in every locale.
 */
export interface Strings {
  ribbon: {
    openChat: string;
  };
  commands: {
    openChat: string;
  };
  chat: {
    placeholder: string;
    /** Serif greeting shown centered in the transcript while it is empty. */
    welcome: string;
    newButtonAria: string;
    sendButtonAria: string;
    stopButtonAria: string;
    modelMenuTitle: string;
    /** Tooltip on the model button; `model` is the full model id in use. */
    modelButtonAria: (model: string) => string;
    /** Shown on the model button when no model id is configured yet. */
    modelUnset: string;
    effortMenuTitle: string;
    effortButtonAria: (effort: string) => string;
    effortNames: Record<EffortLevel, string>;
    missingApiKey: string;
    confirmNewTitle: string;
    confirmNewMessage: string;
    confirmNewAction: string;
  };
  modal: {
    cancel: string;
  };
  toolCall: {
    running: string;
    done: string;
    failed: string;
  };
  agent: {
    unknownApiError: string;
    maxIterationsReached: (max: number) => string;
  };
  api: {
    /** `detail` may be empty when the endpoint returned no usable body. */
    error: (status: number, type: string | undefined, detail: string) => string;
    noDetail: string;
  };
  settings: {
    language: string;
    languageDesc: string;
    languageAuto: string;
    apiKey: string;
    apiKeyDesc: string;
    baseUrl: string;
    baseUrlDesc: (defaultUrl: string) => string;
    model: string;
    modelDesc: string;
    modelOptions: string;
    modelOptionsDesc: string;
    fetchModels: string;
    fetchModelsDesc: string;
    fetchModelsButton: string;
    fetchModelsFetching: string;
    /** `added` ids were new and merged in, out of `total` the endpoint returned. */
    fetchModelsResult: (added: number, total: number) => string;
    fetchModelsFailed: (detail: string) => string;
    testConnection: string;
    testConnectionDesc: string;
    testConnectionButton: string;
    testModalTitle: string;
    testRunning: (model: string) => string;
    testSuccess: (model: string) => string;
    testFailed: (model: string, detail: string) => string;
    effort: string;
    effortDesc: string;
    maxOutputTokens: string;
    maxOutputTokensDesc: string;
    maxIterations: string;
    maxIterationsDesc: string;
    systemPrompt: string;
    feishu: string;
    /** `name` may be empty when the profile fetch failed; still connected. */
    feishuDescConnected: (name: string) => string;
    feishuDescDisconnected: string;
    feishuConnectButton: string;
    feishuDisconnectButton: string;
    /** Notice shown when the app-creation confirmation page is opened. */
    feishuStageRegistering: string;
    /** Notice shown when the authorization confirmation page is opened. */
    feishuStageAuthorizing: string;
    feishuConnected: (name: string) => string;
    feishuConnectFailed: (detail: string) => string;
    feishuDisconnected: string;
  };
}
