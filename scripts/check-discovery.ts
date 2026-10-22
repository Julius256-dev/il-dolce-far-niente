/**
 * Proves the skills.sh pathway: `npx skills add Julius256-dev/il-dolce-far-niente`
 * must offer exactly the `install` skill (every workflow skill is
 * `metadata.internal`, because it needs the project files the installer writes)
 * and must parse every SKILL.md without skipping one.
 *
 *   npx tsx scripts/check-discovery.ts
 *
 * Needs network access to the npm registry. The CLI version is pinned.
 */
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_CLI = "skills@1.7.4";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = spawnSync("npx", ["-y", SKILLS_CLI, "add", repoRoot, "--list"], {
  cwd: os.tmpdir(),
  encoding: "utf8",
  env: { ...process.env, CI: "1", NO_COLOR: "1" }
});
// eslint-disable-next-line no-control-regex
const output = `${result.stdout}${result.stderr}`.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const problems: string[] = [];
if (result.status !== 0) problems.push(`skills CLI exited ${result.status}`);
const skipped = output.split("\n").filter((line) => /Skipped .*SKILL\.md/.test(line));
if (skipped.length) problems.push(`skills CLI could not parse:\n${skipped.join("\n")}`);
const found = output.match(/Found (\d+) skills?/);
if (!found) problems.push("skills CLI did not report what it found");
else if (found[1] !== "1") problems.push(`skills CLI offers ${found[1]} skills; expected only install`);
if (!/^\|?\s+install\s*$/m.test(output)) problems.push("skills CLI does not offer the install skill");

if (problems.length) {
  console.error(`skills.sh discovery check failed (${SKILLS_CLI}):\n- ${problems.join("\n- ")}\n\n${output}`);
  process.exit(1);
}
console.log(`skills.sh discovery: only the install skill is offered (${SKILLS_CLI}).`);
