import { t } from "@/i18n";

import type { ConversationMessage, EffortLevel, StreamEvent, ToolDefinition } from "./types";

export const DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic";
const API_VERSION = "2023-06-01";

export interface StreamRequest {
  apiKey: string;
  baseUrl: string;
  model: string;
  effort: EffortLevel;
  system: string;
  messages: ConversationMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  signal: AbortSignal;
}

function messagesUrl(baseUrl: string): string {
  const trimmed = (baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return `${trimmed}/v1/messages`;
}

/**
 * Sends a streaming request to the Anthropic Messages API and yields parsed
 * SSE events. Uses plain fetch + manual SSE parsing because Obsidian's
 * requestUrl() does not support streaming responses, and this must work
 * identically in the mobile (Capacitor WebView) runtime, which has no
 * Node APIs available.
 */
export async function* streamMessage(req: StreamRequest): AsyncGenerator<StreamEvent> {
  const response = await fetch(messagesUrl(req.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": req.apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: req.model,
      output_config: { effort: req.effort },
      system: req.system,
      messages: req.messages,
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      max_tokens: req.maxTokens,
      stream: true,
    }),
    signal: req.signal,
  });

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new Error(formatApiError(response.status, body));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      // SSE events are separated by a blank line ("\n\n").
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const event = parseSseEvent(rawEvent);
        if (event) yield event;
      }
    }
    // Flush any trailing event that wasn't terminated by a final blank line.
    if (buffer.trim()) {
      const event = parseSseEvent(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

interface ApiErrorBody {
  error?: {
    type?: string;
    message?: string | null;
    code?: string | null;
  };
  message?: string | null;
}

/**
 * Builds a readable error message from a non-ok HTTP response. Both
 * Anthropic's error shape ({type, error: {type, message}}) and common
 * OpenAI-compatible proxy shapes ({error: {message, type, code}}) are
 * handled, since Base URL can point at a third-party gateway.
 */
function formatApiError(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as ApiErrorBody;
    const err = parsed.error;
    const detail = err?.message ?? parsed.message ?? err?.code ?? undefined;
    const type = err?.type;
    if (detail || type) {
      return t().api.error(status, type, detail ?? t().api.noDetail);
    }
  } catch {
    // Body wasn't JSON — fall through to the raw text below.
  }
  const trimmed = bodyText.trim();
  return t().api.error(status, undefined, trimmed.slice(0, 500));
}

function parseSseEvent(rawEvent: string): StreamEvent | null {
  const dataLines: string[] = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return null;
  try {
    return JSON.parse(data) as StreamEvent;
  } catch {
    return null;
  }
}

/**
 * Candidate /v1/models locations, most specific first. Gateways that expose
 * an Anthropic-compatible API under a path (e.g. DeepSeek's /anthropic)
 * often serve their model list only at the domain root, so when the base URL
 * carries a path we also try the origin.
 */
function modelsUrls(baseUrl: string): string[] {
  const trimmed = (baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const urls = [`${trimmed}/v1/models`];
  try {
    const origin = new URL(trimmed).origin;
    if (origin && origin !== trimmed) urls.push(`${origin}/v1/models`);
  } catch {
    // Not a parseable absolute URL — just use the single candidate.
  }
  return urls;
}

/**
 * Asks the endpoint for the model ids it advertises via GET /v1/models.
 * Success is judged by the response body, never the HTTP status alone: some
 * gateways wrap auth errors in HTTP 200, so anything that doesn't parse into
 * a model array is reported as a failure with whatever detail the body gave.
 * Sends both auth header styles since Base URL may point at an
 * OpenAI-compatible gateway whose /models route ignores x-api-key.
 */
export async function fetchModels(opts: {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  let lastError: Error | null = null;
  for (const url of modelsUrls(opts.baseUrl)) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": opts.apiKey,
        authorization: `Bearer ${opts.apiKey}`,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      signal: opts.signal,
    });
    const bodyText = await response.text().catch(() => "");
    const ids = response.ok ? parseModelList(bodyText) : null;
    if (ids) return ids;
    // Keep the later (origin) error: on gateways like DeepSeek the pathed
    // URL is a bare 404 while the origin gives the actionable message.
    lastError = new Error(formatApiError(response.status, bodyText));
  }
  throw lastError ?? new Error(t().agent.unknownApiError);
}

/**
 * Extracts model ids from an Anthropic-style or OpenAI-style /v1/models body
 * ({data: [{id}]} or a bare array), or null when the shape is unrecognized —
 * which includes the "error wrapped in HTTP 200" bodies some gateways return.
 */
function parseModelList(bodyText: string): string[] | null {
  try {
    const parsed = JSON.parse(bodyText) as { data?: unknown } | unknown[];
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed).data)
        ? ((parsed as { data: unknown[] }).data)
        : null;
    if (!list) return null;
    const ids: string[] = [];
    for (const entry of list) {
      const id = typeof entry === "string" ? entry : (entry as { id?: unknown } | null)?.id;
      if (typeof id === "string" && id.trim()) ids.push(id.trim());
    }
    return ids;
  } catch {
    return null;
  }
}

/**
 * Verifies the configuration by sending a real streaming "hi" through
 * streamMessage — the exact fetch + SSE code path chat uses — and passing
 * only once the first valid stream event arrives. A gateway that answers
 * non-streaming requests but breaks SSE therefore fails here, exactly as it
 * would fail real chat. The request is aborted right after that first event
 * so the test costs next to nothing.
 */
export async function testConnection(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  effort: EffortLevel;
  timeoutMs?: number;
}): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const stream = streamMessage({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      model: opts.model,
      effort: opts.effort,
      system: "",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      maxTokens: 16,
      signal: controller.signal,
    });
    for await (const event of stream) {
      if (event.type === "error") {
        throw new Error(t().api.error(200, event.error.type, event.error.message || t().api.noDetail));
      }
      if (event.type === "ping") continue;
      return;
    }
    // Stream closed without a single event: not a working streaming endpoint.
    throw new Error(t().agent.unknownApiError);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
