import { ItemView, Menu, Notice, Platform, setIcon, WorkspaceLeaf } from "obsidian";

import { runAgentLoop } from "@/core/AgentLoop";
import type { ConversationMessage, EffortLevel } from "@/core/types";
import { EFFORT_LEVELS } from "@/core/types";
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
  private modelButton!: HTMLButtonElement;
  private modelLabelEl!: HTMLElement;
  private effortButton!: HTMLButtonElement;
  private effortLabelEl!: HTMLElement;
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
    this.modelButton = buttonRow.createEl("button", { cls: "claudian-mobile-chip-button" });
    setIcon(this.modelButton.createSpan({ cls: "claudian-mobile-chip-icon" }), "bot");
    this.modelLabelEl = this.modelButton.createSpan({ cls: "claudian-mobile-chip-label" });
    this.modelButton.addEventListener("click", (evt) => this.openModelMenu(evt));
    this.effortButton = buttonRow.createEl("button", { cls: "claudian-mobile-chip-button" });
    setIcon(this.effortButton.createSpan({ cls: "claudian-mobile-chip-icon" }), "zap");
    this.effortLabelEl = this.effortButton.createSpan({ cls: "claudian-mobile-chip-label" });
    this.effortButton.addEventListener("click", (evt) => this.openEffortMenu(evt));
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
    this.refreshComposerState();
  }

  /**
   * Re-labels the model and effort chips from the current settings. Called
   * after either chip is used, and by the plugin after the settings tab
   * changes the same values, so the two never drift apart.
   */
  refreshComposerState(): void {
    // The settings tab can save before onOpen() has built the composer.
    if (!this.modelButton) return;
    const strings = t().chat;
    const model = this.plugin.settings.model;
    // setText() on the button itself would wipe out the leading icon span.
    this.modelLabelEl.setText(model ? shortModelLabel(model) : strings.modelUnset);
    this.modelButton.setAttr("aria-label", strings.modelButtonAria(model || strings.modelUnset));

    const effortName = strings.effortNames[this.plugin.settings.effort];
    this.effortLabelEl.setText(effortName);
    this.effortButton.setAttr("aria-label", strings.effortButtonAria(effortName));
  }

  /** Model ids offered by the chip: the configured list, plus whatever is active. */
  private modelChoices(): string[] {
    const options = this.plugin.settings.modelOptions;
    const current = this.plugin.settings.model;
    return current && !options.includes(current) ? [current, ...options] : options;
  }

  private openModelMenu(evt: MouseEvent): void {
    const strings = t().chat;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(strings.modelMenuTitle).setIsLabel(true));
    for (const model of this.modelChoices()) {
      menu.addItem((item) =>
        item
          .setTitle(model)
          .setChecked(model === this.plugin.settings.model)
          .onClick(() => void this.applySettingChange(() => {
            this.plugin.settings.model = model;
          })),
      );
    }
    menu.showAtMouseEvent(evt);
  }

  private openEffortMenu(evt: MouseEvent): void {
    const strings = t().chat;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(strings.effortMenuTitle).setIsLabel(true));
    for (const level of EFFORT_LEVELS) {
      menu.addItem((item) =>
        item
          .setTitle(strings.effortNames[level])
          .setChecked(level === this.plugin.settings.effort)
          .onClick(() => void this.applySettingChange(() => {
            this.plugin.settings.effort = level as EffortLevel;
          })),
      );
    }
    menu.showAtMouseEvent(evt);
  }

  /**
   * Applies a chip's pick to the shared settings. saveSettings() persists it
   * and re-labels the chips in every open chat view, this one included.
   */
  private async applySettingChange(mutate: () => void): Promise<void> {
    mutate();
    await this.plugin.saveSettings();
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
    // The in-flight request already carries the old model/effort; block the
    // chips so a mid-stream switch can't look like it applied to this turn.
    this.modelButton.disabled = streaming;
    this.effortButton.disabled = streaming;
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

/** "claude-haiku-4-5-20251001" -> "haiku-4-5": enough to tell the chips apart. */
export function shortModelLabel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
