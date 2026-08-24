import { ItemView, Notice, Platform, WorkspaceLeaf } from "obsidian";

import { runAgentLoop } from "@/core/AgentLoop";
import type { ConversationMessage } from "@/core/types";
import { t } from "@/i18n";
import type ClaudianMobilePlugin from "@/main";

import { confirmAction } from "./ConfirmModal";
import { StreamRenderer } from "./StreamRenderer";

export const VIEW_TYPE_CHAT = "claudian-mobile-chat";

/**
 * Sidebar chat view: message list + composer, driving AgentLoop and
 * persisting the single active conversation through the plugin's
 * ConversationStore. Deliberately single-conversation (no multi-tab session
 * manager) to keep the mobile v1 minimal.
 */
export class ChatView extends ItemView {
  private messages: ConversationMessage[] = [];
  private streamRenderer!: StreamRenderer;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private newButton!: HTMLButtonElement;
  private sendButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private isStreaming = false;
  private abortController: AbortController | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ClaudianMobilePlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return "Claudian Mobile";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("claudian-mobile-view");

    this.messagesEl = root.createDiv({ cls: "claudian-mobile-messages" });
    this.streamRenderer = new StreamRenderer(this.app, this.messagesEl, this);

    const composer = root.createDiv({ cls: "claudian-mobile-composer" });
    this.inputEl = composer.createEl("textarea", {
      cls: "claudian-mobile-input",
      attr: { rows: "1" },
    });
    this.inputEl.addEventListener("input", () => this.autoResize());
    this.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.shiftKey && !Platform.isMobile) {
        evt.preventDefault();
        void this.handleSend();
      }
    });

    const buttonRow = composer.createDiv({ cls: "claudian-mobile-composer-buttons" });
    this.newButton = buttonRow.createEl("button", { cls: "claudian-mobile-new-button" });
    this.newButton.addEventListener("click", () => void this.handleNewConversation());
    this.sendButton = buttonRow.createEl("button", { cls: "claudian-mobile-send-button mod-cta" });
    this.sendButton.addEventListener("click", () => void this.handleSend());
    this.stopButton = buttonRow.createEl("button", { cls: "claudian-mobile-stop-button" });
    this.stopButton.hide();
    this.stopButton.addEventListener("click", () => this.abortController?.abort());
    this.applyLanguage();

    this.messages = await this.plugin.conversationStore.load();
    await this.renderHistory();
  }

  async onClose(): Promise<void> {
    this.abortController?.abort();
  }

  /** Writes the current locale into the composer chrome. */
  private applyLanguage(): void {
    const strings = t().chat;
    this.inputEl.setAttr("placeholder", strings.placeholder);
    this.newButton.setText(strings.newButton);
    this.newButton.setAttr("aria-label", strings.newButtonAria);
    this.sendButton.setText(strings.sendButton);
    this.stopButton.setText(strings.stopButton);
  }

  /**
   * Re-labels the view after the Language setting changes. Already-rendered
   * tool-call blocks carry localized status text too, so the transcript is
   * rebuilt as well — except mid-stream, where the live turn owns the DOM.
   */
  async refreshLanguage(): Promise<void> {
    this.applyLanguage();
    if (this.isStreaming) return;
    this.messagesEl.empty();
    await this.renderHistory();
  }

  private autoResize(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 160)}px`;
  }

  private async renderHistory(): Promise<void> {
    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];

      if (msg.role === "user") {
        for (const block of msg.content) {
          if (block.type === "text") this.streamRenderer.renderUserMessage(block.text);
        }
        continue;
      }

      const handle = this.streamRenderer.beginAssistantTurn();
      for (const block of msg.content) {
        if (block.type === "text") {
          handle.appendText(block.text);
        } else if (block.type === "tool_use") {
          handle.startToolCall(block.id, block.name);
          handle.setToolCallInput(block.id, block.input);
        }
      }

      const next = this.messages[i + 1];
      if (next?.role === "user") {
        for (const block of next.content) {
          if (block.type === "tool_result") {
            handle.completeToolCall(block.tool_use_id, { content: block.content, isError: block.is_error });
          }
        }
      }
      await handle.finalize();
    }
  }

  private setStreaming(streaming: boolean): void {
    this.isStreaming = streaming;
    this.sendButton.toggle(!streaming);
    this.stopButton.toggle(streaming);
    this.newButton.disabled = streaming;
    this.inputEl.disabled = streaming;
  }

  /**
   * Clears the conversation and starts fresh. Blocked mid-stream so an
   * in-flight turn can't write its "done" messages back over the cleared
   * state, and confirmed first because the reset also wipes the persisted
   * copy in the plugin data store.
   */
  private async handleNewConversation(): Promise<void> {
    if (this.isStreaming) return;

    if (this.messages.length > 0) {
      const confirmed = await confirmAction(this.app, {
        title: t().chat.confirmNewTitle,
        message: t().chat.confirmNewMessage,
        confirmText: t().chat.confirmNewAction,
      });
      if (!confirmed) return;
    }

    this.messages = [];
    await this.plugin.conversationStore.clear();
    this.messagesEl.empty();
    this.inputEl.value = "";
    this.autoResize();
    this.inputEl.focus();
  }

  private async handleSend(): Promise<void> {
    if (this.isStreaming) return;
    const text = this.inputEl.value.trim();
    if (!text) return;
    if (!this.plugin.settings.apiKey) {
      new Notice(t().chat.missingApiKey);
      return;
    }

    this.inputEl.value = "";
    this.autoResize();

    // If the previous turn never got an assistant reply (e.g. it errored
    // out before completing), the last message is still role "user".
    // Appending a second consecutive user message would violate the API's
    // strict user/assistant alternation on the next request, so fold the
    // new text into that same trailing message instead of starting a new one.
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage?.role === "user") {
      lastMessage.content.push({ type: "text", text });
    } else {
      this.messages.push({ role: "user", content: [{ type: "text", text }] });
    }
    this.streamRenderer.renderUserMessage(text);
    await this.plugin.conversationStore.save(this.messages);

    this.setStreaming(true);
    this.abortController = new AbortController();
    const handle = this.streamRenderer.beginAssistantTurn();

    try {
      for await (const event of runAgentLoop(
        this.messages,
        this.plugin.tools,
        this.plugin.settings,
        this.abortController.signal,
      )) {
        switch (event.type) {
          case "text_delta":
            handle.appendText(event.text);
            break;
          case "tool_use_start":
            handle.startToolCall(event.id, event.name);
            break;
          case "tool_use_input":
            handle.setToolCallInput(event.id, event.input);
            break;
          case "tool_result":
            handle.completeToolCall(event.id, event.result);
            break;
          case "done":
            this.messages = event.messages;
            await this.plugin.conversationStore.save(this.messages);
            break;
          case "error":
            this.streamRenderer.renderError(event.message);
            break;
          default:
            break;
        }
      }
    } finally {
      await handle.finalize();
      this.setStreaming(false);
      this.abortController = null;
    }
  }
}
