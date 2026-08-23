import { TFile, type Vault } from "obsidian";

import type { RegisteredTool } from "@/core/types";
import { toSafeVaultPath } from "./pathSafety";

interface WriteNoteInput {
  path: string;
  content: string;
}

export function createWriteNoteTool(vault: Vault): RegisteredTool {
  return {
    definition: {
      name: "write_note",
      description:
        "Overwrite the entire content of an existing note at a vault-relative path. Creates the note if it does not already exist.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Vault-relative path to the note, e.g. \"Folder/Note.md\"." },
          content: { type: "string", description: "The full new content of the note." },
        },
        required: ["path", "content"],
      },
    },
    async execute(rawInput) {
      const { path, content } = rawInput as WriteNoteInput;
      const safePath = toSafeVaultPath(path);

      const file = vault.getAbstractFileByPath(safePath);
      if (file instanceof TFile) {
        await vault.modify(file, content);
        return { content: `Overwrote "${safePath}".` };
      }

      const folder = safePath.includes("/") ? safePath.slice(0, safePath.lastIndexOf("/")) : "";
      if (folder && !vault.getAbstractFileByPath(folder)) {
        await vault.createFolder(folder).catch(() => undefined);
      }
      await vault.create(safePath, content);
      return { content: `Created "${safePath}" (did not previously exist).` };
    },
  };
}
