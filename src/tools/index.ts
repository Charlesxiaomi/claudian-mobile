import type { Vault } from "obsidian";

import type { RegisteredTool } from "@/core/types";
import { createCreateNoteTool } from "./createNote";
import { createListFilesTool } from "./listFiles";
import { createPatchNoteTool } from "./patchNote";
import { createReadNoteTool } from "./readNote";
import { createSearchVaultTool } from "./searchVault";
import { createWriteNoteTool } from "./writeNote";

export function createToolRegistry(vault: Vault): Map<string, RegisteredTool> {
  const tools = [
    createReadNoteTool(vault),
    createWriteNoteTool(vault),
    createPatchNoteTool(vault),
    createCreateNoteTool(vault),
    createSearchVaultTool(vault),
    createListFilesTool(vault),
  ];
  return new Map(tools.map((tool) => [tool.definition.name, tool]));
}
