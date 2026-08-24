/**
 * Keeps manifest.json and versions.json in step with package.json.
 *
 * Runs from npm's `version` lifecycle hook, i.e. after `npm version <bump>`
 * has rewritten package.json but before it commits and tags — so the edits
 * below land inside that same commit.
 */
import fs from "node:fs";
import process from "node:process";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const version = readJson("package.json").version;

const manifest = readJson("manifest.json");
manifest.version = version;
writeJson("manifest.json", manifest);

// versions.json tells older Obsidian installs which plugin release they can
// still take, so every published version needs an entry.
const versions = readJson("versions.json");
versions[version] = manifest.minAppVersion;
writeJson("versions.json", versions);

process.stdout.write(`[version-bump] ${version} (minAppVersion ${manifest.minAppVersion})\n`);
