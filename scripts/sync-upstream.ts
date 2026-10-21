/**
 * Pull upstream changes from the pinned subtrees in upstream/ into our working
 * copies, using a three-way merge per file.
 *
 *   base   = .upstream-base/<target>   (transformed upstream file at the last sync)
 *   ours   = <target>                  (our edited copy)
 *   theirs = transform(upstream file)  (transformed upstream file now)
 *
 * Usage:
 *   tsx scripts/sync-upstream.ts            merge upstream into our copies
 *   tsx scripts/sync-upstream.ts --check    report what would change, write nothing
 *   tsx scripts/sync-upstream.ts --report <file>   also write a Markdown summary (for PR bodies)
 *
 * Exit codes: 0 clean, 1 error, 2 merged with conflicts (conflict markers left in files).
 */
import { spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const lockPath = path.join(repoRoot, "upstream.lock.json");
const baseRoot = path.join(repoRoot, ".upstream-base");

interface Source {
  repo: string;
  ref: string;
  prefix: string;
  commit: string;
  version?: string;
  license: string;
  copyright: string;
}

interface Mapping {
  source: string;
  from: string;
  to: string;
  transform?: "matt";
  include?: string[];
  exclude?: string[];
  /** Upstream-relative path -> our relative path, for files we renamed. */
  rename?: Record<string, string>;
}

interface Lock {
  schemaVersion: number;
  sources: Record<string, Source>;
  mappings: Mapping[];
  renames: Record<string, string>;
}

type Outcome =
  | "added"
  | "updated"
  | "merged"
  | "conflict"
  | "kept-ours"
  | "unchanged"
  | "removed"
  | "removed-upstream-kept-ours"
  | "skipped-deleted-locally";

interface Result {
  target: string;
  outcome: Outcome;
}

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const reportIndex = args.indexOf("--report");
const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : undefined;

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const stat = await fs.stat(root).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return [""];
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  }
  await walk(root, "");
  return out.sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rename Matt Pocock skill references to our namespaced names. Only explicit
 * skill references change: frontmatter names, Skill-tool calls, slash commands
 * and "the `x` skill" phrases. Prose words such as "research" stay untouched.
 */
export function transformMatt(content: string, renames: Record<string, string>): string {
  const names = Object.keys(renames).sort((a, b) => b.length - a.length);
  const alternation = names.map(escapeRegExp).join("|");
  let text = content;

  // Frontmatter name.
  text = text.replace(/^(---\r?\n[\s\S]*?^name:\s*)([a-z0-9-]+)\s*$/m, (match, prefix: string, name: string) =>
    renames[name] ? `${prefix}${renames[name]}` : match
  );

  // Quoted or backticked names on lines that call the Skill tool.
  text = text
    .split("\n")
    .map((line) =>
      /Skill tool/.test(line)
        ? line.replace(new RegExp(`(["\`])(${alternation})\\1`, "g"), (_m, q: string, name: string) => `${q}${renames[name]}${q}`)
        : line
    )
    .join("\n");

  // Slash commands such as `/triage` or (/to-spec).
  text = text.replace(new RegExp(`(^|[\\s(\`'"\\[])/(${alternation})(?![\\w-])`, "g"), (_m, lead: string, name: string) => `${lead}/${renames[name]}`);

  // "the `tdd` skill", "`code-review` skill".
  text = text.replace(new RegExp(`\`(${alternation})\`(\\s+skill)`, "g"), (_m, name: string, tail: string) => `\`${renames[name]}\`${tail}`);

  return text;
}

function mergeFile(ours: string, base: string, theirs: string): { text: string; conflicts: boolean } {
  const dir = os.tmpdir();
  const stamp = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const files = ["ours", "base", "theirs"].map((n) => path.join(dir, `idfn-${stamp}-${n}`));
  fsSync.writeFileSync(files[0], ours);
  fsSync.writeFileSync(files[1], base);
  fsSync.writeFileSync(files[2], theirs);
  const result = spawnSync("git", ["merge-file", "-p", "-L", "ours", "-L", "base", "-L", "upstream", ...files], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  for (const f of files) fsSync.rmSync(f, { force: true });
  if (result.status === null || result.status < 0) {
    throw new Error(`git merge-file failed: ${result.stderr}`);
  }
  return { text: result.stdout, conflicts: result.status > 0 };
}

function subtreeCommit(prefix: string): string | null {
  const log = spawnSync("git", ["log", "--grep", `git-subtree-dir: ${prefix}$`, "--format=%B", "-n", "1"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const match = log.stdout.match(/git-subtree-split:\s*([0-9a-f]+)/);
  return match ? match[1] : null;
}

function selected(rel: string, mapping: Mapping): boolean {
  const name = rel.split("/").pop() ?? rel;
  if (mapping.include && !mapping.include.includes(rel) && !mapping.include.includes(name)) return false;
  if (mapping.exclude && (mapping.exclude.includes(rel) || mapping.exclude.includes(name))) return false;
  return true;
}

async function syncMapping(lock: Lock, mapping: Mapping, results: Result[]): Promise<void> {
  const source = lock.sources[mapping.source];
  if (!source) throw new Error(`Unknown source ${mapping.source}`);
  const fromRoot = path.join(repoRoot, source.prefix, mapping.from);
    const baseDir = path.join(baseRoot, mapping.to);
  // Paths owned by a more specific mapping nested under this one (for example
  // skills/mp-tdd under skills) belong to that mapping, not this one.
  const nested = lock.mappings
    .filter((other) => other !== mapping && other.to.startsWith(`${mapping.to}/`))
    .map((other) => other.to.slice(mapping.to.length + 1));
  const ownedHere = (rel: string): boolean => !nested.some((n) => rel === n || rel.startsWith(`${n}/`));
  const baseFiles = (await listFiles(baseDir)).filter((rel) => selected(rel, mapping) && ownedHere(rel));
  const rename = mapping.rename ?? {};
  const inverse = Object.fromEntries(Object.entries(rename).map(([from, to]) => [to, from]));
  const toOurs = (rel: string): string => rename[rel] ?? rel;
  const toUpstream = (rel: string): string => inverse[rel] ?? rel;
  const upstreamFiles = (await listFiles(fromRoot)).filter((rel) => selected(rel, mapping) && ownedHere(rel));
  // Work in our path space: upstream files are renamed first, base files already are.
  const all = new Set([...upstreamFiles.map(toOurs), ...baseFiles]);

  for (const rel of [...all].sort()) {
    const upstreamRel = toUpstream(rel);
    const upstreamFile = upstreamRel ? path.join(fromRoot, upstreamRel) : fromRoot;
    const targetRel = rel ? `${mapping.to}/${rel}` : mapping.to;
    const targetFile = path.join(repoRoot, targetRel);
    const baseFile = path.join(baseRoot, targetRel);

    const rawTheirs = await readOrNull(upstreamFile);
    const theirs =
      rawTheirs !== null && mapping.transform === "matt" ? transformMatt(rawTheirs, lock.renames) : rawTheirs;
    const base = await readOrNull(baseFile);
    const ours = await readOrNull(targetFile);

    const write = async (file: string, text: string): Promise<void> => {
      if (checkOnly) return;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text);
    };
    const remove = async (file: string): Promise<void> => {
      if (!checkOnly) await fs.rm(file, { force: true });
    };

    if (theirs === null) {
      // Upstream deleted the file.
      if (ours === null || ours === base) {
        await remove(targetFile);
        await remove(baseFile);
        results.push({ target: targetRel, outcome: "removed" });
      } else {
        await remove(baseFile);
        results.push({ target: targetRel, outcome: "removed-upstream-kept-ours" });
      }
      continue;
    }

    if (ours === null) {
      if (base !== null) {
        // We deleted it on purpose; keep it deleted but track the new base.
        await write(baseFile, theirs);
        results.push({ target: targetRel, outcome: "skipped-deleted-locally" });
      } else {
        await write(targetFile, theirs);
        await write(baseFile, theirs);
        results.push({ target: targetRel, outcome: "added" });
      }
      continue;
    }

    if (base === null) {
      // No baseline yet (first sync over an existing file): treat ours as the edit.
      const merged = mergeFile(ours, theirs, theirs);
      await write(baseFile, theirs);
      results.push({ target: targetRel, outcome: merged.text === ours ? "kept-ours" : "merged" });
      continue;
    }

    if (theirs === base) {
      results.push({ target: targetRel, outcome: ours === base ? "unchanged" : "kept-ours" });
      continue;
    }

    if (ours === base) {
      await write(targetFile, theirs);
      await write(baseFile, theirs);
      results.push({ target: targetRel, outcome: "updated" });
      continue;
    }

    const merged = mergeFile(ours, base, theirs);
    await write(targetFile, merged.text);
    await write(baseFile, theirs);
    results.push({ target: targetRel, outcome: merged.conflicts ? "conflict" : "merged" });
  }
}

function summarize(lock: Lock, results: Result[], before: Record<string, string>): string {
  const counts = new Map<Outcome, number>();
  for (const r of results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  const lines: string[] = ["## Upstream sync", ""];
  for (const [name, source] of Object.entries(lock.sources)) {
    const from = before[name]?.slice(0, 12);
    const to = source.commit.slice(0, 12);
    lines.push(`- **${name}**: ${from === to ? `unchanged at \`${to}\`` : `\`${from}\` → \`${to}\``} (${source.repo})`);
  }
  lines.push("", "| Outcome | Files |", "| --- | --- |");
  for (const [outcome, n] of [...counts.entries()].sort()) lines.push(`| ${outcome} | ${n} |`);
  const notable = results.filter((r) => !["unchanged", "kept-ours"].includes(r.outcome));
  if (notable.length) {
    lines.push("", "<details><summary>Changed files</summary>", "");
    for (const r of notable) lines.push(`- \`${r.target}\`: ${r.outcome}`);
    lines.push("", "</details>");
  }
  const conflicts = results.filter((r) => r.outcome === "conflict");
  if (conflicts.length) {
    lines.push("", "### Conflicts to resolve", "");
    for (const r of conflicts) lines.push(`- [ ] \`${r.target}\``);
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8")) as Lock;
  const before = Object.fromEntries(Object.entries(lock.sources).map(([k, v]) => [k, v.commit]));

  for (const [name, source] of Object.entries(lock.sources)) {
    if (!(await exists(path.join(repoRoot, source.prefix)))) {
      throw new Error(`Missing upstream subtree for ${name} at ${source.prefix}`);
    }
    const commit = subtreeCommit(source.prefix);
    if (commit) source.commit = commit;
  }

  const results: Result[] = [];
  for (const mapping of lock.mappings) await syncMapping(lock, mapping, results);

  if (!checkOnly) await fs.writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n");

  const report = summarize(lock, results, before);
  if (reportPath) await fs.writeFile(reportPath, report);
  process.stdout.write(report);

  if (results.some((r) => r.outcome === "conflict")) process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
