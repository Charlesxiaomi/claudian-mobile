import { TFile, type Vault } from "obsidian";

import type { RegisteredTool } from "@/core/types";
import { toSafeVaultPath } from "./pathSafety";

interface PatchNoteInput {
  path: string;
  old_string: string;
  new_string: string;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

export function createPatchNoteTool(vault: Vault): RegisteredTool {
  return {
    definition: {
      name: "patch_note",
      description:
        "Replace one exact occurrence of old_string with new_string in an existing note. old_string must match exactly once in the file — include enough surrounding context to make it unique. Use this instead of write_note for small, targeted edits.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Vault-relative path to the note." },
          old_string: { type: "string", description: "Exact text to find, must be unique within the note." },
          new_string: { type: "string", description: "Text to replace it with." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
    async execute(rawInput) {
      const { path, old_string: oldString, new_string: newString } = rawInput as PatchNoteInput;
      const safePath = toSafeVaultPath(path);

      const file = vault.getAbstractFileByPath(safePath);
      if (!(file instanceof TFile)) {
        return { content: `No note found at "${safePath}".`, isError: true };
      }
      if (oldString === "") {
        return { content: "old_string must not be empty.", isError: true };
      }

      const original = await vault.read(file);
      const occurrences = countOccurrences(original, oldString);
      if (occurrences === 0) {
        return { content: `old_string was not found in "${safePath}".`, isError: true };
      }
      if (occurrences > 1) {
        return {
          content: `old_string matched ${occurrences} times in "${safePath}" — include more surrounding context to make it unique.`,
          isError: true,
        };
      }

      const index = original.indexOf(oldString);
      const updated = original.slice(0, index) + newString + original.slice(index + oldString.length);
      await vault.modify(file, updated);

      return { content: `Patched "${safePath}".` };
    },
  };
}
