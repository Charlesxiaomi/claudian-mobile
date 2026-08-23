import type { Vault } from "obsidian";

import type { RegisteredTool } from "@/core/types";
import { toSafeVaultPath } from "./pathSafety";

interface ListFilesInput {
  folder?: string;
}

const MAX_RESULTS = 500;

export function createListFilesTool(vault: Vault): RegisteredTool {
  return {
    definition: {
      name: "list_files",
      description: "List file paths in the vault, optionally restricted to a folder (vault-relative).",
      input_schema: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Vault-relative folder to list within. Omit to list the whole vault." },
        },
      },
    },
    async execute(rawInput) {
      const { folder } = (rawInput ?? {}) as ListFilesInput;
      const prefix = folder ? toSafeVaultPath(folder).replace(/\/$/, "") + "/" : "";

      const paths = vault
        .getFiles()
        .map((f) => f.path)
        .filter((p) => (prefix ? p.startsWith(prefix) : true))
        .sort();

      if (paths.length === 0) {
        return { content: prefix ? `No files found under "${prefix}".` : "The vault has no files." };
      }

      const truncated = paths.length > MAX_RESULTS;
      const shown = paths.slice(0, MAX_RESULTS);
      const suffix = truncated ? `\n\n[truncated — ${paths.length - MAX_RESULTS} more files omitted]` : "";
      return { content: shown.join("\n") + suffix };
    },
  };
}
