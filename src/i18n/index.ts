import { moment } from "obsidian";

import { en } from "./en";
import type { Language, LanguageSetting, Strings } from "./types";
import { zhCn } from "./zh-cn";

export type { Language, LanguageSetting, Strings } from "./types";

const LOCALES: Record<Language, Strings> = {
  en,
  "zh-cn": zhCn,
};

/** Native names, intentionally untranslated so each option is readable in any locale. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  "zh-cn": "简体中文",
};

export const LANGUAGE_SETTINGS: LanguageSetting[] = ["auto", "en", "zh-cn"];

const DEFAULT_LANGUAGE: Language = "en";

let activeLanguage: Language = DEFAULT_LANGUAGE;

/**
 * Maps a BCP-47-ish tag onto a shipped locale, or null when we have no
 * translation for it. Traditional Chinese deliberately does not fall back to
 * the Simplified UI — an English UI is the lesser surprise there.
 */
function matchLanguage(tag: string | null | undefined): Language | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  if (lower.startsWith("zh")) {
    return /hant|tw|hk|mo/.test(lower) ? null : "zh-cn";
  }
  if (lower.startsWith("en")) return "en";
  return null;
}

/**
 * Obsidian keeps the global moment locale in sync with its UI language
 * setting, so this reflects the app language without touching storage.
 * Wrapped in a try/catch in case a host build ever drops the shim.
 */
function obsidianLanguage(): string | null {
  try {
    return moment.locale();
  } catch {
    return null;
  }
}

function navigatorLanguage(): string | null {
  return typeof navigator === "undefined" ? null : (navigator.language ?? null);
}

export function detectLanguage(): Language {
  return matchLanguage(obsidianLanguage()) ?? matchLanguage(navigatorLanguage()) ?? DEFAULT_LANGUAGE;
}

export function resolveLanguage(setting: LanguageSetting): Language {
  return setting === "auto" ? detectLanguage() : setting;
}

/** Called on load and whenever the Language setting changes. */
export function setLanguage(setting: LanguageSetting): void {
  activeLanguage = resolveLanguage(setting);
}

export function getActiveLanguage(): Language {
  return activeLanguage;
}

/** The active locale's strings: `t().chat.sendButton`. */
export function t(): Strings {
  return LOCALES[activeLanguage];
}
