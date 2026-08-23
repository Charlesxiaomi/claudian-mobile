import type { Vault } from "obsidian";

import type { RegisteredTool } from "@/core/types";

interface SearchVaultInput {
  query: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SNIPPET_RADIUS = 60;

export function createSearchVaultTool(vault: Vault): RegisteredTool {
  return {
    definition: {
      name: "search_vault",
      description:
        "Case-insensitive substring search for a query string across all markdown notes in the vault. Returns matching file paths, line numbers, and a short snippet per match.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for." },
          limit: { type: "number", description: `Maximum number of matches to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
        },
        required: ["query"],
      },
    },
    async execute(rawInput) {
      const { query, limit } = rawInput as SearchVaultInput;
      if (!query || !query.trim()) {
        return { content: "query must not be empty.", isError: true };
      }
      const cap = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
      const needle = query.toLowerCase();

      const matches: string[] = [];
      for (const file of vault.getMarkdownFiles()) {
        if (matches.length >= cap) break;
        const text = await vault.cachedRead(file);
        const lines = text.split("\n");
        for (let i = 0; i < lines.length && matches.length < cap; i++) {
          const line = lines[i];
          const idx = line.toLowerCase().indexOf(needle);
          if (idx === -1) continue;
          const start = Math.max(0, idx - SNIPPET_RADIUS);
          const end = Math.min(line.length, idx + needle.length + SNIPPET_RADIUS);
          const snippet = (start > 0 ? "…" : "") + line.slice(start, end) + (end < line.length ? "…" : "");
          matches.push(`${file.path}:${i + 1}: ${snippet}`);
        }
      }

      if (matches.length === 0) {
        return { content: `No matches for "${query}".` };
      }
      return { content: matches.join("\n") };
    },
  };
}
