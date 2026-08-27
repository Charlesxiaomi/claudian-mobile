import { ItemView, Menu, Notice, Platform, setIcon, WorkspaceLeaf } from "obsidian";

import { runAgentLoop } from "@/core/AgentLoop";
import type { ConversationMessage } from "@/core/types";
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
  private welcomeEl: HTMLElement | null = null;
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
  /** Distance between the two fingers when the current pinch began; 0 = not pinching. */
  private pinchStartDistance = 0;
  private pinchStartZoom = 1;

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
    this.applyChatZoom();
    this.registerPinchZoom();

    // Claudian-style composer: a single bordered card holding the borderless
    // textarea and, below it, one toolbar row of quiet controls. Desktop
    // Claudian splits these across a nav row and a toolbar; on a phone the
    // vertical space matters more, so everything folds into one row.
    const composer = root.createDiv({ cls: "claudian-mobile-composer" });
    const wrapper = composer.createDiv({ cls: "claudian-mobile-input-wrapper" });
    this.inputEl = wrapper.createEl("textarea", {
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

    const toolbar = wrapper.createDiv({ cls: "claudian-mobile-input-toolbar" });
    // square-pen, not plus: a "+" here reads as "attach", which this is not.
    this.newButton = toolbar.createEl("button", { cls: "claudian-mobile-icon-button" });
    setIcon(this.newButton, "square-pen");
    this.newButton.addEventListener("click", () => void this.handleNewConversation());
    this.modelButton = toolbar.createEl("button", { cls: "claudian-mobile-chip-button" });
    this.modelLabelEl = this.modelButton.createSpan({ cls: "claudian-mobile-chip-label" });
    setIcon(this.modelButton.createSpan({ cls: "claudian-mobile-chip-chevron" }), "chevron-down");
    this.modelButton.addEventListener("click", (evt) => this.openModelMenu(evt));
    this.effortButton = toolbar.createEl("button", { cls: "claudian-mobile-chip-button" });
    this.effortLabelEl = this.effortButton.createSpan({ cls: "claudian-mobile-chip-label" });
    setIcon(this.effortButton.createSpan({ cls: "claudian-mobile-chip-chevron" }), "chevron-down");
    this.effortButton.addEventListener("click", (evt) => this.openEffortMenu(evt));
    this.sendButton = toolbar.createEl("button", { cls: "claudian-mobile-send-button" });
    setIcon(this.sendButton, "arrow-up");
    this.sendButton.addEventListener("click", () => void this.handleSend());
    this.stopButton = toolbar.createEl("button", { cls: "claudian-mobile-stop-button" });
    setIcon(this.stopButton, "square");
    this.stopButton.hide();
    this.stopButton.addEventListener("click", () => this.abortController?.abort());
    this.applyLanguage();

    this.messages = await this.plugin.conversationStore.load();
    await this.renderHistory();
    this.updateWelcome();
  }

  async onClose(): Promise<void> {
    this.abortController?.abort();
  }

  /** Writes the current locale into the composer chrome. */
  private applyLanguage(): void {
    const strings = t().chat;
    this.inputEl.setAttr("placeholder", strings.placeholder);
    this.newButton.setAttr("aria-label", strings.newButtonAria);
    this.sendButton.setAttr("aria-label", strings.sendButtonAria);
    this.stopButton.setAttr("aria-label", strings.stopButtonAria);
    this.refreshComposerState();
  }

  /**
   * Keeps the claude.ai-style serif greeting in the transcript while the
   * conversation is empty, and drops it as soon as the first message lands.
   */
  private updateWelcome(): void {
    const empty = this.messages.length === 0;
    if (empty && !this.welcomeEl) {
      this.welcomeEl = this.messagesEl.createDiv({ cls: "claudian-mobile-welcome" });
      this.welcomeEl.createDiv({ cls: "claudian-mobile-welcome-text", text: t().chat.welcome });
    } else if (!empty && this.welcomeEl) {
      this.welcomeEl.remove();
      this.welcomeEl = null;
    }
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
            this.plugin.settings.effort = level;
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
    this.welcomeEl = null;
    await this.renderHistory();
    this.updateWelcome();
  }

  /**
   * Two-finger pinch on the transcript scales the message text, since
   * Obsidian mobile disables the WebView's native pinch zoom outright.
   * CSS `zoom` (unlike transform: scale) reflows the text to the new size.
   */
  private registerPinchZoom(): void {
    const distance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    this.registerDomEvent(
      this.messagesEl,
      "touchstart",
      (evt: TouchEvent) => {
        if (evt.touches.length !== 2) return;
        this.pinchStartDistance = distance(evt.touches);
        this.pinchStartZoom = this.plugin.settings.chatZoom;
      },
      { passive: true },
    );

    this.registerDomEvent(
      this.messagesEl,
      "touchmove",
      (evt: TouchEvent) => {
        if (evt.touches.length !== 2 || this.pinchStartDistance === 0) return;
        // Without this the browser treats the two fingers as a scroll.
        evt.preventDefault();
        this.plugin.settings.chatZoom = clampChatZoom(
          this.pinchStartZoom * (distance(evt.touches) / this.pinchStartDistance),
        );
        this.applyChatZoom();
      },
      { passive: false },
    );

    const endPinch = (evt: TouchEvent) => {
      if (this.pinchStartDistance === 0 || evt.touches.length >= 2) return;
      this.pinchStartDistance = 0;
      void this.plugin.saveSettings();
    };
    this.registerDomEvent(this.messagesEl, "touchend", endPinch);
    this.registerDomEvent(this.messagesEl, "touchcancel", endPinch);
  }

  private applyChatZoom(): void {
    const zoom = this.plugin.settings.chatZoom;
    this.messagesEl.style.setProperty("zoom", zoom === 1 ? "" : String(zoom));
  }

  private autoResize(): void {
    this.inputEl.setCssStyles({ height: "auto" });
    this.inputEl.setCssStyles({ height: `${Math.min(this.inputEl.scrollHeight, 160)}px` });
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
    this.welcomeEl = null;
    this.updateWelcome();
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
    this.updateWelcome();
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

const CHAT_ZOOM_MIN = 0.6;
const CHAT_ZOOM_MAX = 2.5;

/**
 * Clamps a persisted or in-gesture zoom factor; anything unusable (missing in
 * old data.json, hand-edited garbage) falls back to 1, and near-1 values snap
 * to exactly 1 so a sloppy pinch can still land back on the default size.
 */
export function clampChatZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  const clamped = Math.min(CHAT_ZOOM_MAX, Math.max(CHAT_ZOOM_MIN, value));
  return Math.abs(clamped - 1) < 0.05 ? 1 : clamped;
}
