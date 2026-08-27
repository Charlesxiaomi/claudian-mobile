import js from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Same rule set the community directory's automated review runs, scoped to
  // src/ (its JSON-parser entries for package.json are kept as-is).
  ...obsidianmd.configs.recommended.map((cfg) =>
    JSON.stringify(cfg.files ?? []).includes("package.json") ? cfg : { ...cfg, files: ["src/**/*.ts"] },
  ),
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Type-aware rules matching the community directory's automated review.
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
    },
  },
  {
    ignores: ["main.js", "styles.css", "node_modules/**"],
  },
);
