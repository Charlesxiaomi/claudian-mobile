import type { Strings } from "./types";

export const en: Strings = {
  ribbon: {
    openChat: "Open Claudian Mobile",
  },
  commands: {
    openChat: "Open chat",
  },
  chat: {
    placeholder: "Ask Claudian…",
    newButton: "New",
    newButtonAria: "Start a new conversation",
    sendButton: "Send",
    stopButton: "Stop",
    modelMenuTitle: "Model",
    modelButtonAria: (model) => `Model: ${model}`,
    modelUnset: "Model",
    effortMenuTitle: "Reasoning effort",
    effortButtonAria: (effort) => `Reasoning effort: ${effort}`,
    effortNames: {
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extra high",
      max: "Max",
    },
    missingApiKey: "Set your Anthropic API key in Claudian Mobile settings first.",
    confirmNewTitle: "New conversation",
    confirmNewMessage: "This clears the current conversation. It cannot be undone.",
    confirmNewAction: "Start new",
  },
  modal: {
    cancel: "Cancel",
  },
  toolCall: {
    running: "running…",
    done: "done",
    failed: "failed",
  },
  agent: {
    unknownApiError: "Unknown API error.",
    maxIterationsReached: (max) => `Stopped after reaching the maximum of ${max} tool-use iterations.`,
  },
  api: {
    error: (status, type, detail) =>
      `Anthropic API error ${status}${type ? ` (${type})` : ""}${detail ? `: ${detail}` : ""}`,
    noDetail: "no further detail provided",
  },
  settings: {
    language: "Language",
    languageDesc:
      "Language for the Claudian Mobile interface. The ribbon entry and command palette entry pick up " +
      "the change after the plugin is reloaded.",
    languageAuto: "Follow Obsidian",
    apiKey: "Anthropic API key",
    apiKeyDesc:
      "Stored in plaintext in this device's vault config (.obsidian/plugins/claudian-mobile/data.json). " +
      "Do not use a key you aren't comfortable having on this device, especially if the vault is synced.",
    baseUrl: "Base URL",
    baseUrlDesc: (defaultUrl) =>
      "The Anthropic Messages API endpoint to call. Change this to point at a third-party or self-hosted " +
      "gateway that implements the same /v1/messages streaming API (e.g. Kimi, GLM, or a proxy). " +
      `Default: ${defaultUrl}`,
    model: "Model",
    modelDesc: "The model id sent to the API above. Third-party endpoints often use their own model names.",
    modelOptions: "Model list",
    modelOptionsDesc:
      "One model id per line. These are the choices offered by the model button above the composer; " +
      "picking one there updates the Model setting.",
    effort: "Reasoning effort",
    effortDesc:
      "Sent as output_config.effort, which controls how much the model thinks before answering.",
    maxOutputTokens: "Max output tokens",
    maxOutputTokensDesc: "Upper bound on tokens the model can generate per turn.",
    maxIterations: "Max tool-use iterations",
    maxIterationsDesc: "Safety cap on how many tool-call round-trips a single reply can make.",
    systemPrompt: "System prompt",
  },
};
