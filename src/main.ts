import { Plugin, WorkspaceLeaf } from "obsidian";

import type { AgentSettings, RegisteredTool } from "@/core/types";
import { ConversationStore } from "@/store/ConversationStore";
import { createToolRegistry } from "@/tools";
import { ChatView, VIEW_TYPE_CHAT } from "@/ui/ChatView";
import { ClaudianMobileSettingsTab, DEFAULT_SETTINGS } from "@/ui/SettingsTab";

export default class ClaudianMobilePlugin extends Plugin {
  settings: AgentSettings = DEFAULT_SETTINGS;
  tools!: Map<string, RegisteredTool>;
  conversationStore!: ConversationStore;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.tools = createToolRegistry(this.app.vault);
    this.conversationStore = new ConversationStore(this, () => this.settings);

    this.registerView(VIEW_TYPE_CHAT, (leaf: WorkspaceLeaf) => new ChatView(leaf, this));

    this.addRibbonIcon("bot", "Open Claudian Mobile", () => void this.activateView());
    this.addCommand({
      id: "open-claudian-mobile-chat",
      name: "Open chat",
      callback: () => void this.activateView(),
    });

    this.addSettingTab(new ClaudianMobileSettingsTab(this.app, this));
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
  }

  async saveSettings(): Promise<void> {
    await this.conversationStore.persistCurrent();
  }
}
