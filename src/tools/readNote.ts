import { TFile, type Vault } from "obsidian";

import type { RegisteredTool } from "@/core/types";
import { toSafeVaultPath } from "./pathSafety";

interface ReadNoteInput {
  path: string;
}

export function createReadNoteTool(vault: Vault): RegisteredTool {
  return {
    definition: {
      name: "read_note",
      description: "Read the full text content of a note in the vault, given its vault-relative path.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Vault-relative path to the note, e.g. \"Folder/Note.md\"." },
        },
        required: ["path"],
      },
    },
    async execute(rawInput) {
      const { path } = rawInput as ReadNoteInput;
      const safePath = toSafeVaultPath(path);
      const file = vault.getAbstractFileByPath(safePath);
      if (!(file instanceof TFile)) {
        return { content: `No note found at "${safePath}".`, isError: true };
      }
      const content = await vault.read(file);
      return { content };
    },
  };
}
