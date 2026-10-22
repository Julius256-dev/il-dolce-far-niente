/**
 * Set one version everywhere a channel reads it, then check the changelog.
 *
 *   npx tsx scripts/release-version.ts 0.3.0          write it
 *   npx tsx scripts/release-version.ts --check v0.3.0 verify a release tag
 *
 * Files: packages/il-dolce-far-niente/package.json (npm), its package-lock.json,
 * plugin/.claude-plugin/plugin.json (Claude Code), plugin/plugin.json (Codex,
 * Copilot). CHANGELOG.md must have a `## <version>` heading.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  "packages/il-dolce-far-niente/package.json",
  "plugin/.claude-plugin/plugin.json",
  "plugin/plugin.json"
];
const LOCK = "packages/il-dolce-far-niente/package-lock.json";

function read(rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8")) as Record<string, unknown>;
}

function changelogHas(version: string): boolean {
  const text = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  return new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\s|$)`, "m").test(text);
}

const args = process.argv.slice(2);
const check = args[0] === "--check";
const raw = check ? args[1] : args[0];
const version = raw?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: release-version.ts <x.y.z> | --check <vX.Y.Z>");
  process.exit(1);
}

const problems: string[] = [];
if (check) {
  for (const rel of FILES) {
    const found = read(rel).version;
    if (found !== version) problems.push(`${rel} is ${String(found)}, tag is ${version}`);
  }
  if (!changelogHas(version)) problems.push(`CHANGELOG.md has no "## ${version}" heading`);
  if (problems.length) {
    console.error(`Release ${version} is not consistent:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`Release ${version}: every channel and the changelog agree.`);
} else {
  for (const rel of [...FILES, LOCK]) {
    const file = path.join(repoRoot, rel);
    if (!fs.existsSync(file)) continue;
    const json = read(rel);
    json.version = version;
    if (rel === LOCK) {
      const packages = json.packages as Record<string, { version?: string }> | undefined;
      if (packages?.[""]) packages[""].version = version;
    }
    fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  }
  console.log(`Set ${version} in ${FILES.join(", ")}.`);
  if (!changelogHas(version)) console.log(`Add a "## ${version}" section to CHANGELOG.md before tagging v${version}.`);
}
