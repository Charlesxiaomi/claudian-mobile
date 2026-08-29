import type { Vault } from "obsidian";

import type { RegisteredTool } from "@/core/types";
import type { FeishuService } from "@/feishu/FeishuService";
import type { TikHubConfigGetter } from "@/tikhub/api";
import { createCreateNoteTool } from "./createNote";
import { createFeishuReadDocTool } from "./feishuReadDoc";
import { createFeishuSearchDocsTool } from "./feishuSearchDocs";
import { createListFilesTool } from "./listFiles";
import { createPatchNoteTool } from "./patchNote";
import { createReadNoteTool } from "./readNote";
import { createSearchVaultTool } from "./searchVault";
import { createDouyinGetVideoTool } from "./tikhubDouyinVideo";
import { createXhsGetNoteTool } from "./tikhubXhsNote";
import { createXhsSearchNotesTool } from "./tikhubXhsSearch";
import { createXSearchTool } from "./tikhubXSearch";
import { createWriteNoteTool } from "./writeNote";

export function createToolRegistry(vault: Vault, feishu: FeishuService, tikhub: TikHubConfigGetter): Map<string, RegisteredTool> {
  const tools = [
    createReadNoteTool(vault),
    createWriteNoteTool(vault),
    createPatchNoteTool(vault),
    createCreateNoteTool(vault),
    createSearchVaultTool(vault),
    createListFilesTool(vault),
    // Always registered; they answer with a "connect Feishu first" error
    // until the user has connected, so the registry never needs rebuilding.
    createFeishuReadDocTool(feishu),
    createFeishuSearchDocsTool(feishu),
    // Same always-registered pattern: they answer with a "configure TikHub
    // first" error until an API key is set in settings.
    createDouyinGetVideoTool(tikhub),
    createXhsSearchNotesTool(tikhub),
    createXhsGetNoteTool(tikhub),
    createXSearchTool(tikhub),
  ];
  return new Map(tools.map((tool) => [tool.definition.name, tool]));
}
