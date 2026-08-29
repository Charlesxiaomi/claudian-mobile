import type { FeishuAuth } from "@/feishu/types";
import type { LanguageSetting } from "@/i18n";

export type Role = "user" | "assistant";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ConversationMessage {
  role: Role;
  content: ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
}

export type ToolExecutor = (input: unknown) => Promise<ToolExecutionResult>;

export interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

/** Reasoning effort sent as `output_config.effort` on every request. */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

export interface AgentSettings {
  language: LanguageSetting;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Candidates offered by the composer's model button. */
  modelOptions: string[];
  effort: EffortLevel;
  maxOutputTokens: number;
  maxIterations: number;
  systemPrompt: string;
  /** Transcript zoom factor, adjusted by pinching the chat message list. */
  chatZoom: number;
  /** Feishu connection state; null until the user connects. */
  feishu: FeishuAuth | null;
  /** TikHub API key for the Douyin/Xiaohongshu tools; empty until set. */
  tikhubApiKey: string;
  /** Aliyun Bailian (DashScope) API key for speech-to-text (video transcripts); empty until set. */
  dashscopeApiKey: string;
  /** SiliconFlow API key — free speech-to-text fallback when DashScope is unset or fails; empty until set. */
  siliconflowApiKey: string;
  /**
   * TikHub endpoint. Not exposed in the settings UI: requests that fail at
   * the network level automatically retry on the sibling domain (.io/.dev),
   * so only a hand-edited data.json ever needs this.
   */
  tikhubBaseUrl: string;
}

// --- Anthropic Messages API streaming event shapes (subset actually used) ---

export interface MessageStartEvent {
  type: "message_start";
  message: { id: string; role: "assistant"; model: string };
}

export interface ContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  // Anthropic-compatible endpoints can emit block types beyond text/tool_use
  // (e.g. "thinking", "redacted_thinking", or vendor-specific reasoning
  // blocks). Keep this open-ended and let AgentLoop decide, at runtime,
  // which known types to handle — anything else is safely ignored instead
  // of being misparsed as a tool call.
  content_block: { type: string; [key: string]: unknown };
}

export interface ContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "input_json_delta"; partial_json: string };
}

export interface ContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface MessageDeltaEvent {
  type: "message_delta";
  delta: { stop_reason: string | null };
}

export interface MessageStopEvent {
  type: "message_stop";
}

export interface ErrorEvent {
  type: "error";
  error: { type: string; message: string };
}

export interface PingEvent {
  type: "ping";
}

export type StreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | ErrorEvent
  | PingEvent;

// --- Events emitted upward by AgentLoop for incremental UI rendering ---

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_input"; id: string; input: unknown }
  | { type: "tool_result"; id: string; result: ToolExecutionResult }
  | { type: "turn_complete"; message: ConversationMessage }
  | { type: "done"; messages: ConversationMessage[] }
  | { type: "error"; message: string };
