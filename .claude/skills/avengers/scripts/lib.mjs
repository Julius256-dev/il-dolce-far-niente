// Shared helpers for the /avengers scripts. Standalone ESM with no dependencies,
// because installed projects may use CommonJS or have no node_modules at all.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------- canonical stubs

export const FINDINGS_HEADER = `# Findings

> **Generated file.** The findings ledger: review findings raised by \`/audit\`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. \`/implement\` marks repaired findings \`fixed\`, a later \`/audit\` pass
> moves them to \`closed\`, and \`/complete\` refuses to land while any P0 or P1
> finding is \`open\` or \`fixed\`, then archives resolved findings with the work
> and resets this file.
`;

export const FINDINGS_STUB = `${FINDINGS_HEADER}
_No findings recorded. \`/audit\` appends findings here when it finds them._
`;

export const REVIEW_STUB = `# Independent Review

> **Generated file.** Holds the active independent-review request or latest
> receipt for the current work item. \`/audit independent current\` prepares a
> handoff against an approved checkpoint, a fresh reviewer context completes it,
> and \`/complete\` refuses stale, pending, or changes-requested review state.

_No independent review requested. Run \`/audit independent current\` to prepare one._
`;

export const CURRENT_FEATURE_STUB = `# Current Feature

> **Generated file.** Holds the one feature, fix, or rollback being built in this checkout. Run
> \`/feature <number-or-name>\` to spec a build-plan feature, or \`/fix "<bug>"\` for
> an ad-hoc fix. Use \`/rollback <completed-feature>\` to plan a safe reversal.
> Build one thing at a time in this checkout; \`/complete\` archives it under
> \`blueprint/history/\` and resets this file.

_Nothing in progress. Run \`/feature\`, \`/fix\`, or \`/rollback\` to start._
`;

export const PATHS = {
  spec: "blueprint/context/current-feature.md",
  findings: "blueprint/context/findings.md",
  review: "blueprint/context/review.md",
  plan: "blueprint/build-plan.md",
  projectPlan: "blueprint/project-plan.md",
  overview: "blueprint/context/project-overview.md",
  config: "blueprint/config.json",
  localConfig: "blueprint/config.local.json",
  agents: "AGENTS.md",
  featuresDir: "blueprint/history/features",
  stateDir: "blueprint/.state",
  wave: "blueprint/.state/avengers.json"
};

// ---------------------------------------------------------------- errors and output

export class StopError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function stop(code, message, details) {
  throw new StopError(code, message, details);
}

/** Print one JSON result and exit. Exit 0 ok, 1 usage/internal error, 2 stop. */
export async function runMain(fn) {
  try {
    const result = await fn();
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  } catch (error) {
    if (error instanceof StopError) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, stop: error.code, message: error.message, ...error.details }, null, 2)}\n`
      );
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}

export function parseArgs(argv, { flags = [], lists = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = toCamel(eq === -1 ? arg.slice(2) : arg.slice(2, eq));
    if (flags.includes(key)) {
      out[key] = true;
      continue;
    }
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    if (lists.includes(key)) (out[key] ??= []).push(value);
    else out[key] = value;
  }
  return out;
}

function toCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// ---------------------------------------------------------------- git and processes

export function git(cwd, args, { env, input } = {}) {
  return execFileSync("git", args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024
  }).replace(/\n$/, "");
}

export function gitTry(cwd, args, opts) {
  try {
    return { ok: true, out: git(cwd, args, opts) };
  } catch (error) {
    return { ok: false, out: String(error.stdout ?? ""), err: String(error.stderr ?? error.message) };
  }
}

export function gitBuffer(cwd, args) {
  return execFileSync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function showFile(cwd, rev, file) {
  const r = spawnSync("git", ["show", `${rev}:${file}`], { cwd, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

export function topLevel(cwd) {
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

export function currentBranch(cwd) {
  const r = gitTry(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return r.ok ? r.out : null;
}

export function statusPaths(cwd) {
  const out = git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const paths = [];
  const parts = out.split("\0").filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const code = parts[i].slice(0, 2);
    paths.push({ code, path: parts[i].slice(3) });
    if (code[0] === "R" || code[0] === "C") i += 1;
  }
  return paths;
}

/** The commit trailer-free identity rule: never add AI attribution. */
export function commit(cwd, message, { paths, all = false } = {}) {
  if (all) git(cwd, ["add", "-A", "--", "."]);
  else if (paths?.length) git(cwd, ["add", "--", ...paths]);
  git(cwd, ["commit", "--no-verify", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

/** Capture the working tree in a temporary index, exactly as completion-recovery.md does. */
export function captureSourceTree(cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blueprint-completion-"));
  const env = { GIT_INDEX_FILE: path.join(dir, "index") };
  try {
    git(cwd, ["read-tree", "HEAD"], { env });
    git(cwd, ["add", "-A", "--", "."], { env });
    return git(cwd, ["write-tree"], { env });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function treeHas(cwd, treeish, file) {
  return gitTry(cwd, ["cat-file", "-e", `${treeish}:${file}`]).ok;
}

export function runShell(cwd, command, { env, tailLines = 40 } = {}) {
  const started = Date.now();
  const r = spawnSync(command, {
    cwd,
    shell: true,
    env: { ...process.env, ...env, CI: process.env.CI ?? "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const lines = output.split("\n");
  return {
    ok: r.status === 0,
    exitCode: r.status,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    tail: r.status === 0 ? undefined : lines.slice(-tailLines).join("\n")
  };
}

export const SCRATCH_DIR = "blueprint/.state/avengers";

/** Keep per-item scratch (reviewer output, try guide) out of commits, even on older installs. */
export function ensureScratchIgnored(root) {
  const probe = `${SCRATCH_DIR}/probe`;
  if (gitTry(root, ["check-ignore", "-q", probe]).ok) return;
  const common = path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]));
  const exclude = path.join(common, "info", "exclude");
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const current = readText(exclude) ?? "";
  if (!current.split("\n").includes(`/${SCRATCH_DIR}/`)) {
    fs.writeFileSync(exclude, `${current}${current.endsWith("\n") || !current ? "" : "\n"}/${SCRATCH_DIR}/\n`);
  }
}

// ---------------------------------------------------------------- files and config

export function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

const DEFAULTS = {
  git: { landing: "local-merge", featureBranchPrefix: "feature/", fixBranchPrefix: "fix/", rollbackBranchPrefix: "rollback/" },
  qualityGates: {
    continuous: { audit: "manual", independentReview: "when-sensitive", check: "manual", tryGuide: "when-testable" }
  },
  review: { independentExecution: "automatic" },
  continuous: { maxRepairAttempts: 2 },
  avengers: {
    maxConcurrent: 3,
    specApproval: "batch",
    integrationBranchPrefix: "wave/",
    worktreeRoot: "../.worktrees",
    serializeWhen: ["shared-files", "migration", "auth", "payments", "sms", "config"],
    finalIntegrationAudit: true,
    portBase: 4100
  },
  // Keep in step with defaultSensitivePatterns() in the installer's project-config.ts.
  sensitivePatterns: {
    payments: ["pesapal", "flutterwave", "paystack", "stripe", "escrow", "payouts?", "disburse", "refund", "mobile[ _-]?money", "\\bmomo\\b", "payment"],
    sms: ["africa'?s[ _-]?talking", "africastalking", "\\bsms\\b", "\\bussd\\b"],
    webhooks: ["webhook"]
  }
};

export function readConfig(root) {
  const raw = readText(path.join(root, PATHS.config));
  let team = {};
  if (raw !== null) {
    try {
      team = JSON.parse(raw);
    } catch {
      stop("invalid-config", "blueprint/config.json is not valid JSON; run /doctor.");
    }
  }
  let local = {};
  const localRaw = readText(path.join(root, PATHS.localConfig));
  if (localRaw !== null) {
    try {
      local = JSON.parse(localRaw);
    } catch {
      stop("invalid-config", "blueprint/config.local.json is not valid JSON; run /doctor.");
    }
  }
  const avengers = { ...DEFAULTS.avengers, ...(team.avengers ?? {}) };
  if (Number.isInteger(local.avengers?.maxConcurrent)) avengers.maxConcurrent = local.avengers.maxConcurrent;
  // Patterns extend the defaults per category; payments and SMS never drop out.
  const sensitivePatterns = Object.fromEntries(
    Object.entries(DEFAULTS.sensitivePatterns).map(([k, v]) => [k, [...v]])
  );
  for (const [category, list] of Object.entries(team.sensitive?.patterns ?? {})) {
    if (Array.isArray(list)) sensitivePatterns[category] = [...new Set([...(sensitivePatterns[category] ?? []), ...list])];
  }
  return {
    profile: team.profile ?? "custom",
    sensitivePatterns,
    research: { web: team.research?.web !== false },
    dataHandling: {
      sourceMayLeavePremises: team.dataHandling?.sourceMayLeavePremises ?? null,
      approvalRecord: team.dataHandling?.approvalRecord ?? null
    },
    git: { ...DEFAULTS.git, ...(team.git ?? {}) },
    qualityGates: { continuous: { ...DEFAULTS.qualityGates.continuous, ...(team.qualityGates?.continuous ?? {}) } },
    review: { ...DEFAULTS.review, ...(team.review ?? {}) },
    continuous: { ...DEFAULTS.continuous, ...(team.continuous ?? {}) },
    avengers
  };
}

/** The exact Verify command from the Commands section of AGENTS.md. */
export function parseVerifyCommand(agentsText) {
  if (!agentsText) return null;
  const match = agentsText.match(/^\s*[-*]\s+Verify\s*:\s*`([^`]+)`/m);
  return match ? match[1].trim() : null;
}

export function defaultBranch(cwd) {
  for (const ref of ["refs/remotes/origin/HEAD"]) {
    const r = gitTry(cwd, ["symbolic-ref", "--quiet", "--short", ref]);
    if (r.ok) return r.out.replace(/^origin\//, "");
  }
  for (const name of ["main", "master"]) {
    if (gitTry(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]).ok) return name;
  }
  return null;
}

// ---------------------------------------------------------------- specs and IDs

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function kebab(text) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `012A` -> `12a`. Returns null for anything that is not a build-plan ID. */
export function normalizeId(raw) {
  const m = String(raw ?? "").trim().match(/^0*(\d+)([a-zA-Z]?)$/);
  if (!m) return null;
  return `${m[1] === "" ? "0" : m[1]}${m[2].toLowerCase()}`;
}

export function paddedId(id) {
  const m = id.match(/^(\d+)([a-z]?)$/);
  return `${m[1].padStart(2, "0")}${m[2]}`;
}

export function archiveRelPath(id, slug, attempt) {
  const suffix = attempt > 1 ? `--build-${attempt}` : "";
  return `${PATHS.featuresDir}/${paddedId(id)}-${slug}${suffix}.md`;
}

export function findingPrefix(id, attempt) {
  return attempt > 1 ? `${id}-build-${attempt}` : id;
}

function field(text, name) {
  const re = new RegExp(`^\\*\\*${name}:\\*\\*[ \\t]*(.*)$`, "gm");
  const all = [...text.matchAll(re)].map((m) => m[1].trim());
  return all;
}

export function parseSpec(text) {
  if (!text) return null;
  const titleMatch = text.match(/^#\s+(Feature|Fix|Rollback)\s*:\s*(.+?)\s*$/m);
  const fromPlan = field(text, "From build-plan");
  const attempts = field(text, "Build attempt");
  const statuses = field(text, "Status");
  const branches = field(text, "Branch");
  const idMatch = fromPlan[0]?.match(/feature\s+([0-9]+[a-zA-Z]?)/i);
  const attempt = attempts.length === 1 && /^[1-9]\d*$/.test(attempts[0]) ? Number(attempts[0]) : null;
  const steps = [];
  const stepRe = /^\s*- \[( |x|X)\] \*\*Step\b/gm;
  for (const m of text.matchAll(stepRe)) steps.push(m[1] !== " ");
  return {
    kind: titleMatch?.[1]?.toLowerCase() ?? null,
    title: titleMatch?.[2] ?? null,
    rawId: idMatch?.[1] ?? null,
    id: idMatch ? normalizeId(idMatch[1]) : null,
    attempt,
    attemptFields: attempts.length,
    status: statuses[0] ?? null,
    statusFields: statuses.length,
    branch: branches[0]?.replace(/`/g, "") ?? null,
    steps: steps.length,
    stepsChecked: steps.filter(Boolean).length
  };
}

export function setSpecStatus(text, status) {
  return text.replace(/^(\*\*Status:\*\*)[ \t]*.*$/m, `$1 ${status}`);
}

// ---------------------------------------------------------------- build plan

const PLAN_ITEM = /^(\s*)- \[( |x|X)\] ([0-9]+[a-zA-Z]?)\.\s+(.*)$/;

export function parsePlan(text) {
  const lines = text.split("\n");
  const items = [];
  lines.forEach((line, index) => {
    const m = line.match(PLAN_ITEM);
    if (!m) return;
    const rest = m[4];
    const titleMatch = rest.match(/^\*\*(.+?)\*\*/);
    const afterMatch = rest.match(/_\(after:\s*([^)]*)\)_\s*$/);
    let after = null;
    if (afterMatch) {
      const inner = afterMatch[1].trim();
      after = inner === "none" ? [] : inner.split(/\s*,\s*/).map(normalizeId).filter(Boolean);
    }
    items.push({
      index,
      indent: m[1].length,
      checked: m[2] !== " ",
      id: normalizeId(m[3]),
      title: titleMatch ? titleMatch[1] : rest.replace(/_\(after:[^)]*\)_\s*$/, "").trim(),
      after,
      children: []
    });
  });
  // A following item with deeper indentation is a child until indentation returns.
  for (let i = 0; i < items.length; i += 1) {
    let childIndent = null;
    for (let j = i + 1; j < items.length && items[j].indent > items[i].indent; j += 1) {
      childIndent ??= items[j].indent;
      if (items[j].indent <= childIndent) {
        childIndent = items[j].indent;
        items[i].children.push(items[j].id);
      }
    }
  }
  return { lines, items };
}

function setChecked(line, checked) {
  return line.replace(/^(\s*- \[)( |x|X)(\])/, `$1${checked ? "x" : " "}$3`);
}

/** Tick one item, then any parent whose children are now all checked. */
export function tickPlan(text, id) {
  const { lines, items } = parsePlan(text);
  const target = items.find((item) => item.id === id);
  if (!target) stop("plan-item-missing", `Build-plan item ${id} was not found.`);
  if (target.children.length) stop("plan-item-parent", `Build-plan item ${id} has sub-items; land a leaf.`);
  target.checked = true;
  lines[target.index] = setChecked(lines[target.index], true);
  promoteParents(lines, items);
  return lines.join("\n");
}

function promoteParents(lines, items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (!item.checked && item.children.length && item.children.every((c) => byId.get(c)?.checked)) {
        item.checked = true;
        lines[item.index] = setChecked(lines[item.index], true);
        changed = true;
      }
    }
  }
}

export function normalizePlanMarkers(text) {
  return text.replace(/^(\s*- )\[[xX]\]/gm, "$1[ ]");
}

/**
 * Merge two build plans that differ only in completion markers: keep every tick
 * from either side. Returns null when the plans differ in anything else.
 */
export function unionPlanTicks(ours, theirs) {
  if (normalizePlanMarkers(ours) !== normalizePlanMarkers(theirs)) return null;
  const a = parsePlan(ours);
  const b = parsePlan(theirs);
  const theirChecked = new Map(b.items.map((item) => [item.index, item.checked]));
  for (const item of a.items) {
    if (!item.checked && theirChecked.get(item.index)) {
      item.checked = true;
      a.lines[item.index] = setChecked(a.lines[item.index], true);
    }
  }
  // Non-item checkbox lines (rare) follow the same rule.
  const bl = theirs.split("\n");
  a.lines.forEach((line, i) => {
    if (/^\s*- \[ \]/.test(line) && /^\s*- \[[xX]\]/.test(bl[i] ?? "")) a.lines[i] = setChecked(line, true);
  });
  promoteParents(a.lines, a.items);
  return a.lines.join("\n");
}

/** Leaves that can start now, in plan order. */
export function computeFrontier(text, { exclude = [] } = {}) {
  const { items } = parsePlan(text);
  const byId = new Map(items.map((item) => [item.id, item]));
  const leaves = items.filter((item) => item.children.length === 0);
  const leafDone = (id) => {
    const item = byId.get(id);
    if (!item) return null;
    if (item.children.length === 0) return item.checked;
    return item.children.every((c) => leafDone(c));
  };
  const excluded = new Set(exclude.map(normalizeId));
  const result = [];
  const blocked = [];
  const unknown = [];
  leaves.forEach((leaf, position) => {
    if (leaf.checked || excluded.has(leaf.id)) return;
    let ready;
    let waitingOn = [];
    if (leaf.after === null) {
      waitingOn = leaves.slice(0, position).filter((l) => !l.checked).map((l) => l.id);
      ready = waitingOn.length === 0;
    } else {
      for (const dep of leaf.after) {
        const done = leafDone(dep);
        if (done === null) unknown.push({ id: leaf.id, dependency: dep });
        if (!done) waitingOn.push(dep);
      }
      ready = waitingOn.length === 0;
    }
    const entry = { id: leaf.id, title: leaf.title, edges: leaf.after === null ? "serial" : leaf.after };
    if (ready) result.push(entry);
    else blocked.push({ ...entry, waitingOn });
  });
  return { frontier: result, blocked, unknownDependencies: unknown };
}

// ---------------------------------------------------------------- sensitive categories

/** Categories whose patterns match the text (case-insensitive), with the first hit for each. */
export function classifySensitive(text, patterns) {
  const hits = {};
  for (const [category, list] of Object.entries(patterns)) {
    for (const source of list) {
      const m = String(text ?? "").match(new RegExp(source, "i"));
      if (m) {
        hits[category] = m[0];
        break;
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------- overview fingerprint

export function overviewHash(projectPlanBuf, buildPlanBuf) {
  const normalized = Buffer.from(normalizePlanMarkers(buildPlanBuf.toString("utf8")), "utf8");
  return sha256(Buffer.concat([projectPlanBuf, Buffer.from([0]), normalized]));
}

export function replaceSourceHash(overviewText, hash) {
  const re = /<!-- blueprint:source-hash [0-9a-f]{64} -->/;
  if (!re.test(overviewText)) return null;
  return overviewText.replace(re, `<!-- blueprint:source-hash ${hash} -->`);
}

// ---------------------------------------------------------------- findings ledger

const FINDING_HEADER = /^### (F-(\d+|\?\?)) \[(P[0-3])\] (unverified|open|fixed|closed|accepted|invalid) - (.+)$/;

export function parseLedger(text) {
  if (text === null || text === undefined) return { exists: false, entries: [], malformed: [] };
  const lines = text.split("\n");
  const entries = [];
  const malformed = [];
  let current = null;
  lines.forEach((line, index) => {
    if (line.startsWith("### ")) {
      const m = line.match(FINDING_HEADER);
      if (!m) {
        if (/^### F-/.test(line)) malformed.push({ line: index + 1, text: line });
        if (current) current.lines.push(line);
        return;
      }
      current = {
        id: m[1],
        num: m[2] === "??" ? null : Number(m[2]),
        severity: m[3],
        status: m[4],
        title: m[5],
        lines: [line]
      };
      entries.push(current);
      return;
    }
    if (current) current.lines.push(line);
  });
  for (const entry of entries) {
    while (entry.lines.length && entry.lines.at(-1).trim() === "") entry.lines.pop();
    entry.body = entry.lines.join("\n");
    entry.axis = entry.body.match(/^\*\*Axis:\*\*\s*(\S+)/m)?.[1] ?? null;
    delete entry.lines;
  }
  return { exists: true, entries, malformed };
}

export function renderLedger(entries) {
  if (!entries.length) return FINDINGS_STUB;
  return `${FINDINGS_HEADER}\n${entries.map((e) => e.body).join("\n\n")}\n`;
}

export function setEntryStatus(entry, status, resolution) {
  const lines = entry.body.split("\n");
  lines[0] = lines[0].replace(FINDING_HEADER, (_, id, _n, sev, _s, title) => `### ${id} [${sev}] ${status} - ${title}`);
  let body = lines.join("\n");
  if (resolution) {
    if (/^\*\*Resolution:\*\*/m.test(body)) {
      body = body.replace(/^\*\*Resolution:\*\*[ \t]*(.*)$/m, (_, prior) =>
        `**Resolution:** ${prior.trim() ? `${prior.trim()} ` : ""}${resolution}`
      );
    } else {
      body = `${body}\n\n**Resolution:** ${resolution}`;
    }
  }
  return { ...entry, status, body };
}

export function renumberEntry(entry, newNum, note) {
  const id = `F-${String(newNum).padStart(2, "0")}`;
  let body = entry.body.replace(/^### F-(\d+|\?\?) /, `### ${id} `);
  if (note) {
    if (/^\*\*Found:\*\*/m.test(body)) body = body.replace(/^(\*\*Found:\*\*.*)$/m, `$1 ${note}`);
    else body = body.replace(/^(### .*)$/m, `$1\n\n**Found:** ${note}`);
  }
  return { ...entry, id, num: newNum, body };
}

export function nextFindingNumber(entries) {
  return entries.reduce((max, e) => Math.max(max, e.num ?? 0), 0) + 1;
}

/**
 * Three-way union of findings ledgers when a feature lands on the integration
 * branch. base = ledger at the fork point, ours = integration tip, theirs = feature.
 * Entries the feature archived (removed) are removed; entries it added are
 * appended, taking a fresh ID when the bare ID is already used on the
 * integration branch (the Found line records the original ID).
 */
export function unionLedgers(baseText, oursText, theirsText, { branch }) {
  const base = new Map(parseLedger(baseText).entries.map((e) => [e.id, e]));
  const ours = parseLedger(oursText).entries;
  const theirs = parseLedger(theirsText).entries;
  const theirsById = new Map(theirs.map((e) => [e.id, e]));
  const conflicts = [];
  const renumbered = [];
  const result = [];
  for (const entry of ours) {
    const b = base.get(entry.id);
    const t = theirsById.get(entry.id);
    if (!b) {
      result.push(entry);
      continue;
    }
    if (!t) {
      // The feature archived it. Keep ours only if the integration side changed it too.
      if (entry.body !== b.body) conflicts.push(entry.id);
      continue;
    }
    if (t.body === b.body) result.push(entry);
    else if (entry.body === b.body) result.push(t);
    else if (entry.body === t.body) result.push(entry);
    else conflicts.push(entry.id);
  }
  const used = () => result;
  for (const entry of theirs) {
    if (base.has(entry.id)) continue;
    const clash = used().some((e) => e.id === entry.id);
    if (!clash) {
      result.push(entry);
      continue;
    }
    const num = nextFindingNumber([...result, ...theirs.filter((e) => !base.has(e.id))]);
    const moved = renumberEntry(entry, num, `(landed from \`${branch}\` as ${entry.id})`);
    renumbered.push({ from: entry.id, to: moved.id });
    result.push(moved);
  }
  result.sort((a, b) => (a.num ?? 0) - (b.num ?? 0));
  return { text: renderLedger(result), conflicts, renumbered };
}

// ---------------------------------------------------------------- independent review receipt

export function parseReceipt(text) {
  if (!text || text.trim() === REVIEW_STUB.trim()) return null;
  const get = (name) => field(text, name)[0] ?? null;
  return {
    status: get("Status"),
    target: get("Target commit"),
    baseCommit: get("Base commit"),
    baseRef: get("Base ref"),
    specHash: get("Spec hash"),
    verdict: get("Verdict"),
    reviewerModel: get("Reviewer model"),
    requestedModel: get("Requested model")
  };
}

/** The receipt body for the archive's `## Independent review` section. */
export function receiptArchiveSection(text) {
  const body = text
    .replace(/^# Independent Review\s*\n/, "")
    .replace(/^## /gm, "### ")
    .trim();
  return `## Independent review\n\n${body}\n`;
}
