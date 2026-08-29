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
    welcome: "What can I help with?",
    newButtonAria: "Start a new conversation",
    sendButtonAria: "Send",
    stopButtonAria: "Stop",
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
    missingApiKey: "Set your API key in Claudian Mobile settings first.",
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
      `API error ${status}${type ? ` (${type})` : ""}${detail ? `: ${detail}` : ""}`,
    noDetail: "no further detail provided",
  },
  settings: {
    language: "Language",
    languageDesc:
      "Language for the Claudian Mobile interface. The ribbon entry and command palette entry pick up " +
      "the change after the plugin is reloaded.",
    languageAuto: "Follow Obsidian",
    apiKey: "API key",
    apiKeyDesc:
      "Stored in plaintext in this plugin's data.json inside the vault's config folder on this device. " +
      "Do not use a key you aren't comfortable having on this device, especially if the vault is synced.",
    baseUrl: "Base URL",
    baseUrlDesc: (defaultUrl) =>
      "The Anthropic-compatible Messages API endpoint to call. Point it at any gateway that implements " +
      "the same /v1/messages streaming API (e.g. Anthropic, DeepSeek, Kimi, GLM, or a proxy). " +
      `Default: ${defaultUrl}`,
    model: "Model",
    modelDesc: "The model id sent to the API above. Third-party endpoints often use their own model names.",
    modelOptions: "Model list",
    modelOptionsDesc:
      "One model id per line. These are the choices offered by the model button above the composer; " +
      "picking one there updates the Model setting.",
    fetchModels: "Fetch model list",
    fetchModelsDesc:
      "Asks the endpoint above for /v1/models (falling back to the domain root when the path has none) " +
      "and merges the returned ids into Model list. " +
      "Nothing is ever removed — an id the endpoint doesn't advertise may still work.",
    fetchModelsButton: "Fetch",
    fetchModelsFetching: "Fetching…",
    fetchModelsResult: (added, total) => `Endpoint returned ${total} model(s); ${added} new added to Model list.`,
    fetchModelsFailed: (detail) => `Could not fetch the model list: ${detail}`,
    testConnection: "Test connection",
    testConnectionDesc:
      "Sends a real streaming \"hi\" to the endpoint with a model you pick — the same code path chat uses. " +
      "Passing proves streaming chat works with that model; it says nothing about the other models.",
    testConnectionButton: "Test",
    testModalTitle: "Test which model?",
    testRunning: (model) => `Testing ${model}…`,
    testSuccess: (model) => `${model} works: the endpoint returned a valid streaming response.`,
    testFailed: (model, detail) => `${model} failed: ${detail}`,
    effort: "Reasoning effort",
    effortDesc:
      "Sent as output_config.effort, which controls how much the model thinks before answering.",
    maxOutputTokens: "Max output tokens",
    maxOutputTokensDesc: "Upper bound on tokens the model can generate per turn.",
    maxIterations: "Max tool-use iterations",
    maxIterationsDesc: "Safety cap on how many tool-call round-trips a single reply can make.",
    systemPrompt: "System prompt",
    feishu: "Feishu",
    feishuDescConnected: (name) => (name ? `Connected as ${name}. ` : "Connected. ") + "Chat can search and read your Feishu cloud documents.",
    feishuDescDisconnected:
      "Connect your Feishu account so chat can search and read your Feishu cloud documents. " +
      "A personal Feishu app is created automatically on first connect; you will confirm twice in the browser. " +
      "Credentials and tokens are stored in plaintext in this plugin's data.json, like the API key above.",
    feishuConnectButton: "Connect",
    feishuDisconnectButton: "Disconnect",
    feishuStageRegistering: "Opened the Feishu app-creation page in your browser — confirm there, then come back.",
    feishuStageAuthorizing: "Opened the Feishu authorization page in your browser — approve there, then come back.",
    feishuConnected: (name) => (name ? `Feishu connected as ${name}.` : "Feishu connected."),
    feishuConnectFailed: (detail) => `Feishu connection failed: ${detail}`,
    feishuDisconnected: "Feishu disconnected.",
    tikhubApiKey: "TikHub API key",
    tikhubApiKeyDesc:
      "Lets chat fetch Douyin video details and search Xiaohongshu notes through TikHub (tikhub.io). " +
      "Requests are pay-per-use on your TikHub account; create a token at user.tikhub.io. " +
      "Stored in plaintext in this plugin's data.json, like the API key above.",
  },
};
