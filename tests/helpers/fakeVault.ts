import { TFile } from "obsidian";
import type { Vault } from "obsidian";

/** In-memory fake of the Vault surface used by src/tools/*. */
export function createFakeVault(initialFiles: Record<string, string> = {}): {
  vault: Vault;
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initialFiles));

  const vault = {
    getAbstractFileByPath: jest.fn((path: string) => (files.has(path) ? new TFile(path) : null)),
    read: jest.fn(async (file: TFile) => files.get(file.path) ?? ""),
    cachedRead: jest.fn(async (file: TFile) => files.get(file.path) ?? ""),
    modify: jest.fn(async (file: TFile, content: string) => {
      files.set(file.path, content);
    }),
    create: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
      return new TFile(path);
    }),
    createFolder: jest.fn(async () => undefined),
    getFiles: jest.fn(() => Array.from(files.keys()).map((p) => new TFile(p))),
    getMarkdownFiles: jest.fn(() =>
      Array.from(files.keys())
        .filter((p) => p.endsWith(".md"))
        .map((p) => new TFile(p)),
    ),
  };

  return { vault: vault as unknown as Vault, files };
}
