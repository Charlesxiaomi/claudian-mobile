import type { Plugin } from "obsidian";

import type { AgentSettings, ConversationMessage } from "@/core/types";

export interface PersistedData {
  settings: AgentSettings;
  conversation: ConversationMessage[];
}

/**
 * Persists the single active conversation via Obsidian's plugin data store
 * (saveData/loadData), which survives the app process being killed while
 * backgrounded — important on Android, where in-memory state alone is not
 * enough to keep a conversation across app switches.
 */
export class ConversationStore {
  private messages: ConversationMessage[] = [];

  constructor(
    private readonly plugin: Plugin,
    private readonly getSettings: () => AgentSettings,
  ) {}

  async load(): Promise<ConversationMessage[]> {
    const raw = (await this.plugin.loadData()) as Partial<PersistedData> | null;
    this.messages = raw?.conversation ?? [];
    return this.messages;
  }

  async save(messages: ConversationMessage[]): Promise<void> {
    this.messages = messages;
    await this.persist();
  }

  async clear(): Promise<void> {
    this.messages = [];
    await this.persist();
  }

  getMessages(): ConversationMessage[] {
    return this.messages;
  }

  /** Re-persists the current messages together with the latest settings snapshot. */
  async persistCurrent(): Promise<void> {
    await this.persist();
  }

  private async persist(): Promise<void> {
    const data: PersistedData = {
      settings: this.getSettings(),
      conversation: this.messages,
    };
    await this.plugin.saveData(data);
  }
}
