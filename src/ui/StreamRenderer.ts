import { App, Component, MarkdownRenderer } from "obsidian";

import { ToolCallBlockView } from "./ToolCallBlock";

type Segment = { kind: "text"; el: HTMLElement; raw: string } | { kind: "tool"; block: ToolCallBlockView };

export interface AssistantTurnHandle {
  appendText(delta: string): void;
  startToolCall(id: string, name: string): void;
  setToolCallInput(id: string, input: unknown): void;
  completeToolCall(id: string, result: { content: string; isError?: boolean }): void;
  finalize(): Promise<void>;
}

/**
 * Renders chat messages incrementally into a scrollable container. Text and
 * tool-call blocks are appended as separate ordered DOM segments so that,
 * e.g., text -> tool call -> more text renders in the order the model
 * actually produced it, rather than grouping all text before all tools.
 */
export class StreamRenderer {
  constructor(
    private readonly app: App,
    private readonly containerEl: HTMLElement,
    private readonly component: Component,
  ) {}

  renderUserMessage(text: string): void {
    const bubble = this.containerEl.createDiv({ cls: "claudian-mobile-message claudian-mobile-message-user" });
    bubble.createDiv({ cls: "claudian-mobile-message-text", text });
    this.scrollToBottom();
  }

  renderError(message: string): void {
    this.containerEl.createDiv({ cls: "claudian-mobile-message claudian-mobile-message-error", text: message });
    this.scrollToBottom();
  }

  beginAssistantTurn(): AssistantTurnHandle {
    const bubble = this.containerEl.createDiv({ cls: "claudian-mobile-message claudian-mobile-message-assistant" });
    const segments: Segment[] = [];
    const toolBlocks = new Map<string, ToolCallBlockView>();

    const currentTextSegment = (): Segment & { kind: "text" } => {
      const last = segments[segments.length - 1];
      if (last && last.kind === "text") return last;
      const el = bubble.createDiv({ cls: "claudian-mobile-message-text" });
      const segment: Segment = { kind: "text", el, raw: "" };
      segments.push(segment);
      return segment;
    };

    return {
      appendText: (delta: string) => {
        const segment = currentTextSegment();
        segment.raw += delta;
        segment.el.setText(segment.raw);
        this.scrollToBottom();
      },
      startToolCall: (id: string, name: string) => {
        const block = new ToolCallBlockView(bubble, name);
        toolBlocks.set(id, block);
        segments.push({ kind: "tool", block });
        this.scrollToBottom();
      },
      setToolCallInput: (id: string, input: unknown) => {
        toolBlocks.get(id)?.setInput(input);
      },
      completeToolCall: (id: string, result: { content: string; isError?: boolean }) => {
        toolBlocks.get(id)?.complete(result);
      },
      finalize: async () => {
        for (const segment of segments) {
          if (segment.kind !== "text" || !segment.raw.trim()) continue;
          segment.el.empty();
          await MarkdownRenderer.render(this.app, segment.raw, segment.el, "", this.component);
        }
      },
    };
  }

  private scrollToBottom(): void {
    this.containerEl.scrollTop = this.containerEl.scrollHeight;
  }
}
