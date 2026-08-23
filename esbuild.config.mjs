import esbuild from "esbuild";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";

const production = process.argv[2] === "production";
const vaultDir = process.env.OBSIDIAN_VAULT;

/** @type {import('esbuild').Plugin} */
const copyToObsidian = {
  name: "copy-to-obsidian",
  setup(build) {
    build.onEnd(() => {
      if (!vaultDir) return;
      const dest = path.join(vaultDir, ".obsidian", "plugins", "claudian-mobile");
      fs.mkdirSync(dest, { recursive: true });
      for (const file of ["main.js", "manifest.json", "styles.css"]) {
        const src = path.join(process.cwd(), file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(dest, file));
        }
      }
      console.log(`[copy-to-obsidian] synced to ${dest}`);
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
  plugins: [copyToObsidian],
});

if (production) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
