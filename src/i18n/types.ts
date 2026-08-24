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
    newButton: string;
    newButtonAria: string;
    sendButton: string;
    stopButton: string;
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
    maxOutputTokens: string;
    maxOutputTokensDesc: string;
    maxIterations: string;
    maxIterationsDesc: string;
    systemPrompt: string;
  };
}
