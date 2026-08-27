/**
 * Minimal manual mock of the "obsidian" package for unit tests. The real
 * package is a types-only stub (the actual implementation is supplied by
 * the Obsidian app at runtime via esbuild's `external`), so tests need a
 * runtime stand-in for the pieces this plugin's non-UI code actually uses.
 * Extend this only as new tests need more of the surface.
 */

export function normalizePath(path: string): string {
  let result = path.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  if (result.startsWith("./")) result = result.slice(2);
  if (result.endsWith("/")) result = result.slice(0, -1);
  if (result.startsWith("/")) result = result.slice(1);
  return result;
}

export class TFile {
  path: string;
  basename: string;
  extension: string;

  constructor(path: string) {
    this.path = path;
    const name = path.split("/").pop() ?? path;
    const dot = name.lastIndexOf(".");
    this.basename = dot > 0 ? name.slice(0, dot) : name;
    this.extension = dot > 0 ? name.slice(dot + 1) : "";
  }
}

/**
 * Obsidian re-exports moment and keeps its global locale in sync with the
 * app's UI language. Tests drive detectLanguage() through this knob.
 */
let currentLocale = "en";
export const moment = {
  locale(next?: string): string {
    if (typeof next === "string") currentLocale = next;
    return currentLocale;
  },
};

/**
 * Stand-in for Obsidian's HTTP bridge. Tests drive it with
 * (requestUrl as jest.Mock).mockResolvedValue({ status, text }); the default
 * rejects so a test that forgot to stub it fails loudly instead of hanging.
 */
export const requestUrl = jest.fn(() => Promise.reject(new Error("requestUrl not mocked")));
