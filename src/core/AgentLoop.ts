import { t } from "@/i18n";

import { streamMessage } from "./AnthropicClient";
import type {
  AgentEvent,
  AgentSettings,
  ContentBlock,
  ConversationMessage,
  RegisteredTool,
  ToolUseBlock,
} from "./types";

const MAX_TOOL_RESULT_CHARS = 20_000;

interface PendingBlock {
  index: number;
  type: "text" | "tool_use";
  text: string;
  toolId?: string;
  toolName?: string;
  partialJson: string;
}

/**
 * Runs the tool-use agentic loop against the Anthropic Messages API:
 * stream a turn, execute any requested tools, feed results back, repeat
 * until the model stops asking for tools or the iteration cap is hit.
 * Emits AgentEvent as it goes so the UI can render incrementally.
 */
export async function* runAgentLoop(
  history: ConversationMessage[],
  tools: Map<string, RegisteredTool>,
  settings: AgentSettings,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const messages: ConversationMessage[] = [...history];
  const toolDefinitions = Array.from(tools.values()).map((t) => t.definition);

  for (let iteration = 0; iteration < settings.maxIterations; iteration++) {
    if (signal.aborted) return;

    const blocks = new Map<number, PendingBlock>();
    let stopReason: string | null = null;

    try {
      for await (const event of streamMessage({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        system: settings.systemPrompt,
        messages,
        tools: toolDefinitions,
        maxTokens: settings.maxOutputTokens,
        signal,
      })) {
        switch (event.type) {
          case "content_block_start": {
            const cb = event.content_block;
            if (cb.type === "text") {
              blocks.set(event.index, {
                index: event.index,
                type: "text",
                text: typeof cb.text === "string" ? cb.text : "",
                partialJson: "",
              });
            } else if (cb.type === "tool_use" && typeof cb.id === "string" && typeof cb.name === "string") {
              blocks.set(event.index, {
                index: event.index,
                type: "tool_use",
                text: "",
                toolId: cb.id,
                toolName: cb.name,
                partialJson: "",
              });
              yield { type: "tool_use_start", id: cb.id, name: cb.name };
            }
            // Other block types (e.g. "thinking", "redacted_thinking", or
            // vendor-specific reasoning blocks from third-party endpoints)
            // are intentionally left unregistered — their deltas are then
            // no-ops below, and they never contaminate the persisted
            // conversation as bogus tool calls.
            break;
          }
          case "content_block_delta": {
            const pending = blocks.get(event.index);
            if (!pending) break;
            if (event.delta.type === "text_delta") {
              pending.text += event.delta.text;
              yield { type: "text_delta", text: event.delta.text };
            } else if (event.delta.type === "input_json_delta") {
              pending.partialJson += event.delta.partial_json;
            }
            break;
          }
          case "message_delta": {
            stopReason = event.delta.stop_reason;
            break;
          }
          case "error": {
            const detail = event.error.message || event.error.type || t().agent.unknownApiError;
            const showType = event.error.type && event.error.type !== detail;
            yield { type: "error", message: `${detail}${showType ? ` (${event.error.type})` : ""}` };
            return;
          }
          default:
            break;
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
      return;
    }

    const assistantContent: ContentBlock[] = [];
    const toolUses: ToolUseBlock[] = [];
    for (const pending of Array.from(blocks.values()).sort((a, b) => a.index - b.index)) {
      if (pending.type === "text") {
        if (pending.text.length > 0) {
          assistantContent.push({ type: "text", text: pending.text });
        }
      } else {
        const input = parseToolInput(pending.partialJson);
        const toolUse: ToolUseBlock = {
          type: "tool_use",
          id: pending.toolId!,
          name: pending.toolName!,
          input,
        };
        assistantContent.push(toolUse);
        toolUses.push(toolUse);
        yield { type: "tool_use_input", id: toolUse.id, input };
      }
    }

    const assistantMessage: ConversationMessage = { role: "assistant", content: assistantContent };
    messages.push(assistantMessage);
    yield { type: "turn_complete", message: assistantMessage };

    if (stopReason !== "tool_use" || toolUses.length === 0) {
      yield { type: "done", messages };
      return;
    }

    if (signal.aborted) return;

    const resultBlocks: ContentBlock[] = [];
    for (const call of toolUses) {
      const tool = tools.get(call.name);
      const result = tool
        ? await tool.execute(call.input).catch((err) => ({
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          }))
        : { content: `Unknown tool: ${call.name}`, isError: true };

      const content = truncate(result.content);
      resultBlocks.push({
        type: "tool_result",
        tool_use_id: call.id,
        content,
        is_error: result.isError,
      });
      yield { type: "tool_result", id: call.id, result: { content, isError: result.isError } };
    }

    messages.push({ role: "user", content: resultBlocks });
  }

  yield {
    type: "error",
    message: t().agent.maxIterationsReached(settings.maxIterations),
  };
  yield { type: "done", messages };
}

function parseToolInput(partialJson: string): unknown {
  if (!partialJson.trim()) return {};
  try {
    return JSON.parse(partialJson);
  } catch {
    return {};
  }
}

function truncate(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  return (
    content.slice(0, MAX_TOOL_RESULT_CHARS) +
    `\n\n[truncated — ${content.length - MAX_TOOL_RESULT_CHARS} more characters omitted]`
  );
}
