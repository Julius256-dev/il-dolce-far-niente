/**
 * Generate the tool-specific skill trees from the single source in skills/.
 *
 *   skills/<name>/...      source of truth (Claude form)
 *   .claude/skills/<name>  copied as-is
 *   .agents/skills/<name>  copied with the Claude-only `disable-model-invocation: true`
 *                          frontmatter line removed (Codex, Copilot, Antigravity, OpenCode)
 *
 * Usage:
 *   tsx scripts/build-adapters.ts           write both trees
 *   tsx scripts/build-adapters.ts --check   fail if either tree is out of date
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(repoRoot, "skills");
const targets = [
  { root: path.join(repoRoot, ".claude", "skills"), stripClaudeOnly: false },
  { root: path.join(repoRoot, ".agents", "skills"), stripClaudeOnly: true }
];
const check = process.argv.includes("--check");

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in skills: ${childRel}`);
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  }
  await walk(root, "");
  return out.sort();
}

function render(rel: string, content: Buffer, stripClaudeOnly: boolean): Buffer {
  if (!stripClaudeOnly || !rel.endsWith("SKILL.md")) return content;
  return Buffer.from(content.toString("utf8").replace("disable-model-invocation: true\n", ""), "utf8");
}

async function main(): Promise<void> {
  const sources = await listFiles(sourceRoot);
  if (sources.length === 0) throw new Error("No skills found in skills/");
  const problems: string[] = [];

  for (const target of targets) {
    const existing = new Set(await listFiles(target.root));
    for (const rel of sources) {
      const desired = render(rel, await fs.readFile(path.join(sourceRoot, rel)), target.stripClaudeOnly);
      const file = path.join(target.root, rel);
      existing.delete(rel);
      const current = await fs.readFile(file).catch(() => null);
      if (current && current.equals(desired)) continue;
      if (check) {
        problems.push(`${path.relative(repoRoot, file)} is out of date`);
        continue;
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, desired);
    }
    for (const stale of existing) {
      const file = path.join(target.root, stale);
      if (check) problems.push(`${path.relative(repoRoot, file)} has no source in skills/`);
      else await fs.rm(file);
    }
    if (!check) await pruneEmptyDirs(target.root);
  }

  if (problems.length) {
    console.error(problems.join("\n"));
    console.error("\nRun `npm run build:adapters` and commit the result.");
    process.exit(1);
  }
  console.log(check ? "Adapter trees are up to date." : `Built adapter trees from ${sources.length} source files.`);
}

async function pruneEmptyDirs(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let empty = true;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const childEmpty = await pruneEmptyDirs(path.join(dir, entry.name));
      if (childEmpty) await fs.rmdir(path.join(dir, entry.name));
      else empty = false;
    } else empty = false;
  }
  return empty;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
