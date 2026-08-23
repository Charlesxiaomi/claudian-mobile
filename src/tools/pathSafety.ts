import { normalizePath } from "obsidian";

/**
 * Resolves a model-supplied path to a vault-relative path, rejecting any
 * attempt to escape the vault root (absolute paths, "..", leading "/" or
 * drive letters). Every tool must route paths through this before touching
 * the Vault API.
 */
export function toSafeVaultPath(rawPath: string): string {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new Error("Path must be a non-empty string.");
  }
  if (/^[a-zA-Z]:[\\/]/.test(rawPath) || rawPath.startsWith("/") || rawPath.startsWith("\\")) {
    throw new Error(`Path must be relative to the vault root, got: "${rawPath}"`);
  }

  const normalized = normalizePath(rawPath);
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`Path must not contain "..": "${rawPath}"`);
  }
  return normalized;
}
