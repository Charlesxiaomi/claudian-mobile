import { TFile, type Vault } from "obsidian";

import type { RegisteredTool } from "@/core/types";
import { toSafeVaultPath } from "./pathSafety";

interface CreateNoteInput {
  path: string;
  content?: string;
}

export function createCreateNoteTool(vault: Vault): RegisteredTool {
  return {
    definition: {
      name: "create_note",
      description:
        "Create a new note at a vault-relative path with the given content. Fails if a note already exists there — use write_note to overwrite.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Vault-relative path for the new note, e.g. \"Folder/Note.md\"." },
          content: { type: "string", description: "Initial note content. Defaults to empty." },
        },
        required: ["path"],
      },
    },
    async execute(rawInput) {
      const { path, content = "" } = rawInput as CreateNoteInput;
      const safePath = toSafeVaultPath(path);

      const existing = vault.getAbstractFileByPath(safePath);
      if (existing instanceof TFile) {
        return { content: `A note already exists at "${safePath}". Use write_note to overwrite it.`, isError: true };
      }

      const folder = safePath.includes("/") ? safePath.slice(0, safePath.lastIndexOf("/")) : "";
      if (folder && !vault.getAbstractFileByPath(folder)) {
        await vault.createFolder(folder).catch(() => undefined);
      }

      await vault.create(safePath, content);
      return { content: `Created "${safePath}".` };
    },
  };
}
