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
 *   tsx scripts/sync-upstream.ts --root <dir>      run against another repo root (tests use
 *                                                  this with temp fixture repos); default is
 *                                                  the directory above this script
 *
 * Per-file rules (see `decide`):
 *   - Files are read as bytes. A file is binary when its first 8000 bytes hold a
 *     NUL or it is not valid UTF-8. Binary files are never merged or transformed:
 *     upstream is copied byte for byte when ours equals base, ours is kept when
 *     upstream equals base, otherwise the outcome is "binary-conflict".
 *   - Text: base and theirs are normalised to ours' dominant line ending (CRLF
 *     or LF) before comparing or merging, so a line-ending difference alone
 *     never conflicts.
 *   - No base yet while ours exists: if ours equals theirs the base is recorded
 *     ("unchanged"); otherwise nothing is written and the file is reported as
 *     "needs-baseline" for a human to resolve.
 *   - A failed `git merge-file` (status >= 128, e.g. binary input) is reported
 *     as "error" and nothing is written for that file.
 *
 * Exit codes: 0 clean; 1 error (including any per-file "error");
 *             2 needs a human (conflict, binary-conflict or needs-baseline).
 */
import { spawnSync } from "node:child_process";
import { isUtf8 } from "node:buffer";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");

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

export type Outcome =
  | "added"
  | "updated"
  | "merged"
  | "conflict"
  | "kept-ours"
  | "unchanged"
  | "removed"
  | "removed-upstream-kept-ours"
  | "skipped-deleted-locally"
  | "needs-baseline"
  | "binary-conflict"
  | "error";

export interface Result {
  target: string;
  outcome: Outcome;
  error?: string;
}

/** What to do for one file. Absent fields mean "leave alone". */
export interface Decision {
  outcome: Outcome;
  /** New content for our copy. */
  target?: Buffer;
  /** New content for the base snapshot. */
  base?: Buffer;
  removeTarget?: boolean;
  removeBase?: boolean;
  error?: string;
}

export interface MergeResult {
  status: number | null;
  stdout: Buffer;
  stderr: string;
}

export type MergeFn = (ours: Buffer, base: Buffer, theirs: Buffer) => MergeResult;

/** Outcomes that need a human before the sync can be considered done (exit 2). */
const NEEDS_HUMAN: Outcome[] = ["conflict", "binary-conflict", "needs-baseline"];

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readOrNull(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
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

/** Binary = a NUL byte in the first 8000 bytes, or not valid UTF-8. */
export function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0) || !isUtf8(content);
}

/** The dominant line ending of a text, or null when it has no line breaks. */
export function dominantEol(content: Buffer): "\r\n" | "\n" | null {
  const text = content.toString("utf8");
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return null;
  return crlf > lf ? "\r\n" : "\n";
}

/** Rewrite every line ending in a text to `eol`. */
export function toEol(content: Buffer, eol: "\r\n" | "\n" | null): Buffer {
  if (eol === null) return content;
  const lf = content.toString("utf8").replace(/\r\n/g, "\n");
  return Buffer.from(eol === "\n" ? lf : lf.replace(/\n/g, "\r\n"), "utf8");
}

/** Run `git merge-file -p` on three buffers in a private temp directory. */
export function gitMergeFile(ours: Buffer, base: Buffer, theirs: Buffer): MergeResult {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "idfn-merge-"));
  try {
    const files = ["ours", "base", "theirs"].map((n) => path.join(dir, n));
    fsSync.writeFileSync(files[0], ours);
    fsSync.writeFileSync(files[1], base);
    fsSync.writeFileSync(files[2], theirs);
    const result = spawnSync("git", ["merge-file", "-p", "-L", "ours", "-L", "base", "-L", "upstream", ...files], {
      maxBuffer: 64 * 1024 * 1024
    });
    return {
      status: result.status,
      stdout: result.stdout ?? Buffer.alloc(0),
      stderr: result.error ? result.error.message : (result.stderr?.toString("utf8") ?? "")
    };
  } finally {
    fsSync.rmSync(dir, { recursive: true, force: true });
  }
}

const same = (a: Buffer, b: Buffer): boolean => a.equals(b);

/**
 * Decide what to do with one file. Pure apart from calling `merge` (which
 * defaults to `git merge-file`); it never touches the repository.
 *
 * `theirs` must already be transformed (text only). `binary` is true when any
 * of the three versions is binary.
 */
export function decide(input: {
  ours: Buffer | null;
  base: Buffer | null;
  theirs: Buffer | null;
  binary: boolean;
  merge?: MergeFn;
}): Decision {
  const { ours, base, theirs, binary } = input;
  const merge = input.merge ?? gitMergeFile;
  // Text files are compared in ours' line-ending style.
  const eol = !binary && ours !== null ? dominantEol(ours) : null;
  const norm = (b: Buffer): Buffer => (binary ? b : toEol(b, eol));

  if (theirs === null) {
    // Upstream deleted the file.
    if (ours === null || (base !== null && same(ours, norm(base)))) {
      return { outcome: "removed", removeTarget: true, removeBase: true };
    }
    return { outcome: "removed-upstream-kept-ours", removeBase: true };
  }

  if (ours === null) {
    // Deleted locally on purpose: keep it deleted but track the new base.
    if (base !== null) return { outcome: "skipped-deleted-locally", base: theirs };
    return { outcome: "added", target: theirs, base: theirs };
  }

  const theirsN = norm(theirs);

  if (base === null) {
    // First sync over an existing file. Without the original base we cannot
    // tell our edits from upstream's, so only record a base when they agree.
    if (same(ours, theirsN)) return { outcome: "unchanged", base: theirs };
    return { outcome: "needs-baseline" };
  }

  const baseN = norm(base);
  const refreshBase = same(base, theirs) ? {} : { base: theirs };

  if (same(theirsN, baseN)) {
    return { outcome: same(ours, baseN) ? "unchanged" : "kept-ours", ...refreshBase };
  }

  if (same(ours, baseN)) {
    return { outcome: "updated", target: theirsN, base: theirs };
  }

  if (binary) return { outcome: "binary-conflict" };

  const merged = merge(ours, baseN, theirsN);
  if (merged.status === null || merged.status < 0 || merged.status >= 128) {
    return {
      outcome: "error",
      error: `git merge-file failed (status ${merged.status}): ${merged.stderr.trim()}`
    };
  }
  return { outcome: merged.status === 0 ? "merged" : "conflict", target: merged.stdout, base: theirs };
}

function subtreeCommit(root: string, prefix: string): string | null {
  const log = spawnSync("git", ["log", "--grep", `git-subtree-dir: ${prefix}$`, "--format=%B", "-n", "1"], {
    cwd: root,
    encoding: "utf8"
  });
  const match = (log.stdout ?? "").match(/git-subtree-split:\s*([0-9a-f]+)/);
  return match ? match[1] : null;
}

function selected(rel: string, mapping: Mapping): boolean {
  const name = rel.split("/").pop() ?? rel;
  if (mapping.include && !mapping.include.includes(rel) && !mapping.include.includes(name)) return false;
  if (mapping.exclude && (mapping.exclude.includes(rel) || mapping.exclude.includes(name))) return false;
  return true;
}

interface Context {
  root: string;
  baseRoot: string;
  checkOnly: boolean;
}

async function syncMapping(ctx: Context, lock: Lock, mapping: Mapping, results: Result[]): Promise<void> {
  const source = lock.sources[mapping.source];
  if (!source) throw new Error(`Unknown source ${mapping.source}`);
  const fromRoot = path.join(ctx.root, source.prefix, mapping.from);
  const baseDir = path.join(ctx.baseRoot, mapping.to);
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

  const write = async (file: string, content: Buffer): Promise<void> => {
    if (ctx.checkOnly) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };
  const remove = async (file: string): Promise<void> => {
    if (!ctx.checkOnly) await fs.rm(file, { force: true });
  };

  for (const rel of [...all].sort()) {
    const upstreamRel = toUpstream(rel);
    const upstreamFile = upstreamRel ? path.join(fromRoot, upstreamRel) : fromRoot;
    const targetRel = rel ? `${mapping.to}/${rel}` : mapping.to;
    const targetFile = path.join(ctx.root, targetRel);
    const baseFile = path.join(ctx.baseRoot, targetRel);

    const rawTheirs = await readOrNull(upstreamFile);
    const base = await readOrNull(baseFile);
    const ours = await readOrNull(targetFile);
    const binary = [rawTheirs, base, ours].some((b) => b !== null && isBinary(b));
    const theirs =
      rawTheirs !== null && !binary && mapping.transform === "matt"
        ? Buffer.from(transformMatt(rawTheirs.toString("utf8"), lock.renames), "utf8")
        : rawTheirs;

    const decision = decide({ ours, base, theirs, binary });
    if (decision.removeTarget) await remove(targetFile);
    if (decision.removeBase) await remove(baseFile);
    if (decision.target) await write(targetFile, decision.target);
    if (decision.base) await write(baseFile, decision.base);
    results.push({ target: targetRel, outcome: decision.outcome, ...(decision.error ? { error: decision.error } : {}) });
  }
}

export function summarize(lock: Lock, results: Result[], before: Record<string, string>): string {
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
  const conflicts = results.filter((r) => r.outcome === "conflict" || r.outcome === "binary-conflict");
  if (conflicts.length) {
    lines.push("", "### Conflicts to resolve", "");
    for (const r of conflicts) {
      const note = r.outcome === "binary-conflict" ? " (binary: ours kept, pick ours or upstream by hand)" : "";
      lines.push(`- [ ] \`${r.target}\`${note}`);
    }
  }
  const needsBaseline = results.filter((r) => r.outcome === "needs-baseline");
  if (needsBaseline.length) {
    lines.push(
      "",
      "### Set the baseline by hand",
      "",
      "These files exist in our copy but have no `.upstream-base/` snapshot and differ from upstream, so",
      "upstream changes cannot be told apart from our edits. Nothing was written. For each file, either",
      "copy the (transformed) upstream file from the subtree commit it was originally taken from into",
      "`.upstream-base/<path>` and re-run the sync, or accept upstream by deleting our copy and re-running.",
      ""
    );
    for (const r of needsBaseline) lines.push(`- [ ] \`${r.target}\``);
  }
  const errors = results.filter((r) => r.outcome === "error");
  if (errors.length) {
    lines.push("", "### Errors", "", "Nothing was written for these files.", "");
    for (const r of errors) lines.push(`- \`${r.target}\`: ${r.error ?? "unknown error"}`);
  }
  return lines.join("\n") + "\n";
}

export async function run(options: { root: string; checkOnly: boolean; reportPath?: string }): Promise<{
  results: Result[];
  report: string;
  exitCode: number;
}> {
  const root = path.resolve(options.root);
  const lockPath = path.join(root, "upstream.lock.json");
  const ctx: Context = { root, baseRoot: path.join(root, ".upstream-base"), checkOnly: options.checkOnly };
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8")) as Lock;
  const before = Object.fromEntries(Object.entries(lock.sources).map(([k, v]) => [k, v.commit]));

  for (const [name, source] of Object.entries(lock.sources)) {
    if (!(await exists(path.join(root, source.prefix)))) {
      throw new Error(`Missing upstream subtree for ${name} at ${source.prefix}`);
    }
    const commit = subtreeCommit(root, source.prefix);
    if (commit) source.commit = commit;
  }

  const results: Result[] = [];
  for (const mapping of lock.mappings) await syncMapping(ctx, lock, mapping, results);

  if (!ctx.checkOnly) await fs.writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n");

  const report = summarize(lock, results, before);
  if (options.reportPath) await fs.writeFile(options.reportPath, report);

  const exitCode = results.some((r) => r.outcome === "error")
    ? 1
    : results.some((r) => NEEDS_HUMAN.includes(r.outcome))
      ? 2
      : 0;
  return { results, report, exitCode };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valueOf = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const value = args[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    return value;
  };
  const { report, exitCode } = await run({
    root: valueOf("--root") ?? defaultRoot,
    checkOnly: args.includes("--check"),
    reportPath: valueOf("--report")
  });
  process.stdout.write(report);
  if (exitCode !== 0) process.exit(exitCode);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
