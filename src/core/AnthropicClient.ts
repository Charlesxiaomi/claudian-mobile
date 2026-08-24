import { t } from "@/i18n";

import type { ConversationMessage, StreamEvent, ToolDefinition } from "./types";

export const DEFAULT_BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

export interface StreamRequest {
  apiKey: string;
  baseUrl: string;
  model: string;
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
