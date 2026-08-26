import { moment } from "obsidian";

import { en } from "@/i18n/en";
import { detectLanguage, getActiveLanguage, resolveLanguage, setLanguage, t } from "@/i18n";
import { zhCn } from "@/i18n/zh-cn";

/** Flattens a locale into "settings.model" -> value pairs. */
function flatten(value: unknown, prefix = ""): [string, unknown][] {
  if (typeof value !== "object" || value === null) return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

function keyPaths(locale: unknown): string[] {
  return flatten(locale).map(([path]) => path);
}

describe("locale files", () => {
  it("cover exactly the same keys", () => {
    expect(keyPaths(zhCn).sort()).toEqual(keyPaths(en).sort());
  });

  it("leave no string blank", () => {
    for (const locale of [en, zhCn]) {
      for (const [path, value] of flatten(locale)) {
        if (typeof value === "function") continue;
        expect(typeof value).toBe("string");
        expect(`${path}: ${String(value).trim()}`).not.toBe(`${path}: `);
      }
    }
  });
});

describe("detectLanguage", () => {
  afterEach(() => {
    moment.locale("en");
  });

  it("follows Obsidian's own language setting", () => {
    moment.locale("zh-cn");
    expect(detectLanguage()).toBe("zh-cn");
  });

  it("does not serve a Simplified UI to Traditional Chinese", () => {
    moment.locale("zh-TW");
    expect(detectLanguage()).toBe("en");
  });

  it("falls back to English for locales with no translation", () => {
    moment.locale("ja");
    expect(detectLanguage()).toBe("en");
  });
});

describe("setLanguage", () => {
  afterEach(() => {
    moment.locale("en");
    setLanguage("en");
  });

  it("honours an explicit choice over Obsidian's language", () => {
    moment.locale("zh-cn");
    setLanguage("en");
    expect(getActiveLanguage()).toBe("en");
    expect(t().chat.sendButton).toBe(en.chat.sendButton);
  });

  it("switches the strings t() hands back", () => {
    setLanguage("zh-cn");
    expect(t().chat.sendButton).toBe(zhCn.chat.sendButton);
  });

  it("resolves 'auto' through detection", () => {
    moment.locale("zh-cn");
    expect(resolveLanguage("auto")).toBe("zh-cn");
    setLanguage("auto");
    expect(getActiveLanguage()).toBe("zh-cn");
  });
});
