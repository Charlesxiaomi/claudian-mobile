import { Plugin, WorkspaceLeaf } from "obsidian";

import type { AgentSettings, RegisteredTool } from "@/core/types";
import { setLanguage, t } from "@/i18n";
import { ConversationStore } from "@/store/ConversationStore";
import { createToolRegistry } from "@/tools";
import { ChatView, VIEW_TYPE_CHAT } from "@/ui/ChatView";
import { ClaudianMobileSettingsTab, DEFAULT_SETTINGS } from "@/ui/SettingsTab";

export default class ClaudianMobilePlugin extends Plugin {
  settings: AgentSettings = DEFAULT_SETTINGS;
  tools!: Map<string, RegisteredTool>;
  conversationStore!: ConversationStore;
  private ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.tools = createToolRegistry(this.app.vault);
    this.conversationStore = new ConversationStore(this, () => this.settings);

    this.registerView(VIEW_TYPE_CHAT, (leaf: WorkspaceLeaf) => new ChatView(leaf, this));

    this.ribbonIconEl = this.addRibbonIcon("bot", t().ribbon.openChat, () => void this.activateView());
    // Obsidian reads the command name once, at registration time, so this
    // one only picks up a language change on the next plugin load.
    this.addCommand({
      id: "open-claudian-mobile-chat",
      name: t().commands.openChat,
      callback: () => void this.activateView(),
    });

    this.addSettingTab(new ClaudianMobileSettingsTab(this.app, this));
  }

  /**
   * Called by the settings tab after the Language setting changes: re-label
   * everything that is already on screen. The desktop ribbon tooltip reads
   * straight off aria-label, so it re-labels here; mobile keeps its own copy
   * of the title and only catches up on the next plugin load.
   */
  onLanguageChanged(): void {
    this.ribbonIconEl?.setAttr("aria-label", t().ribbon.openChat);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
      if (leaf.view instanceof ChatView) void leaf.view.refreshLanguage();
    }
  }

  onunload(): void {
    // Views are torn down by Obsidian; ChatView.onClose() aborts any in-flight request.
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
    if (existing) {
      workspace.revealLeaf(existing);
      return;
    }
    const leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    workspace.revealLeaf(leaf);
  }

  private async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as { settings?: Partial<AgentSettings> } | null;
    this.settings = { ...DEFAULT_SETTINGS, ...raw?.settings };
    setLanguage(this.settings.language);
  }

  async saveSettings(): Promise<void> {
    await this.conversationStore.persistCurrent();
  }
}
