#!/usr/bin/env node
// Bookkeeping for /avengers, one call per job. Prints one JSON object.
// Exit 0 ok, 1 usage or internal error, 2 a stop the orchestrator must report.
//
//   preflight                      start conditions, Verify command, frontier
//   frontier [--exclude 3,4]       unblocked build-plan leaves (integration copy once a wave exists)
//   setup --items 3,5 [--install "<cmd>"] [--model-args "<resolver flags>"]
//                                  integration branch + worktree, one branch + worktree + port per item
//   add --items 6 [--install "<cmd>"]   add newly unblocked items, forked from the integration tip
//   state                          the wave record
//   state set --id 3 --status reviewing [--reason ..] [--question ..] [--repair +1]
//   state wave --status integrating
//   verify (--id 3 | --integration)     run the documented Verify command
//   checkpoint --id 3              spec -> verified, review checkpoint commit, target/base SHAs
//   findings --id 3                compact ledger listing for reviewer tasks
//   record --id 3                  record reviewer JSON from blueprint/.state/avengers/review-*.json
//   gate --id 3 [--lens-required]  pass/fail for landing
//   status                         one line per item
//   commit-evidence                commit the integration audit's ledger/receipt on the wave branch
//   close                          after the wave landed: remove integration worktree and record
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  CURRENT_FEATURE_STUB,
  FINDINGS_STUB,
  PATHS,
  REVIEW_STUB,
  computeFrontier,
  currentBranch,
  defaultBranch,
  git,
  gitTry,
  kebab,
  nextFindingNumber,
  normalizeId,
  overviewHash,
  paddedId,
  parseArgs,
  parseLedger,
  parsePlan,
  parseReceipt,
  parseSpec,
  parseVerifyCommand,
  readConfig,
  readText,
  renderLedger,
  runMain,
  runShell,
  setEntryStatus,
  setSpecStatus,
  sha256,
  statusPaths,
  stop,
  SCRATCH_DIR,
  ensureScratchIgnored,
  topLevel,
  writeAtomic
} from "./lib.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);

// ---------------------------------------------------------------- roots and record

function mainRoot(cwd) {
  const top = topLevel(cwd);
  const first = git(top, ["worktree", "list", "--porcelain"]).split("\n")[0].replace(/^worktree /, "");
  return first || top;
}

function recordPath(root) {
  return path.join(root, PATHS.wave);
}

export function loadRecord(root, { required = true } = {}) {
  const text = readText(recordPath(root));
  if (text === null) {
    if (required) stop("no-wave", "No wave record at blueprint/.state/avengers.json.");
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    stop("bad-wave-record", "blueprint/.state/avengers.json is not valid JSON.");
  }
}

function saveRecord(root, record) {
  record.updatedAt = new Date().toISOString();
  writeAtomic(recordPath(root), `${JSON.stringify(record, null, 2)}\n`);
}

function findItem(record, id) {
  const norm = normalizeId(id);
  const item = record.items.find((i) => i.id === norm);
  if (!item) stop("unknown-item", `Item ${id} is not in the wave.`);
  return item;
}

function isScratch(p) {
  return p.startsWith(`${SCRATCH_DIR}/`);
}

// ---------------------------------------------------------------- preflight and frontier

function overviewFresh(root) {
  const overview = readText(path.join(root, PATHS.overview));
  const marker = overview?.match(/<!-- blueprint:source-hash ([0-9a-f]{64}) -->/)?.[1];
  const projectPlan = readBuf(path.join(root, PATHS.projectPlan));
  const buildPlan = readBuf(path.join(root, PATHS.plan));
  if (!marker || !projectPlan || !buildPlan) return false;
  return marker === overviewHash(projectPlan, buildPlan);
}

function readBuf(file) {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

export function preflight(cwd) {
  const root = mainRoot(cwd);
  const config = readConfig(root);
  const problems = [];
  const def = defaultBranch(root);
  const branch = currentBranch(root);
  if (config.avengers.maxConcurrent <= 1) problems.push("avengers.maxConcurrent is 1: parallel builds are off; use /continuous.");
  if (!def) problems.push("No default branch (main or master) found.");
  else if (branch !== def) problems.push(`The main checkout is on ${branch ?? "a detached HEAD"}, not ${def}.`);
  const dirty = statusPaths(root).filter((p) => !p.path.startsWith("blueprint/.state/"));
  if (dirty.length) problems.push(`The main checkout has uncommitted changes: ${dirty.map((p) => p.path).join(", ")}.`);
  const spec = readText(path.join(root, PATHS.spec));
  if (spec !== null && spec !== CURRENT_FEATURE_STUB) problems.push("current-feature.md holds active work; finish it first.");
  const blocking = parseLedger(readText(path.join(root, PATHS.findings))).entries.filter(
    (e) => ["P0", "P1"].includes(e.severity) && ["open", "fixed"].includes(e.status)
  );
  if (blocking.length) problems.push(`Blocking findings: ${blocking.map((e) => e.id).join(", ")}.`);
  const verifyCommand = parseVerifyCommand(readText(path.join(root, PATHS.agents)));
  if (!verifyCommand) problems.push("AGENTS.md declares no Verify command; run /ci.");
  if (!overviewFresh(root)) problems.push("The project overview is stale or has no source hash; run /overview.");
  const record = loadRecord(root, { required: false });
  if (record && record.status !== "landed") problems.push(`Wave ${record.wave} is still recorded; use /avengers resume.`);
  const plan = readText(path.join(root, PATHS.plan)) ?? "";
  const { frontier, blocked, unknownDependencies } = computeFrontier(plan);
  return {
    ready: problems.length === 0,
    problems,
    defaultBranch: def,
    startCommit: def ? git(root, ["rev-parse", def]) : null,
    verifyCommand,
    maxConcurrent: config.avengers.maxConcurrent,
    specApproval: config.avengers.specApproval,
    serializeWhen: config.avengers.serializeWhen,
    gates: config.qualityGates.continuous,
    independentExecution: config.review.independentExecution,
    maxRepairAttempts: config.continuous.maxRepairAttempts,
    finalIntegrationAudit: config.avengers.finalIntegrationAudit,
    landing: config.git.landing,
    frontier,
    blocked: blocked.map((b) => ({ id: b.id, waitingOn: b.waitingOn })),
    unknownDependencies
  };
}

export function frontier(cwd, { exclude = [] } = {}) {
  const root = mainRoot(cwd);
  const record = loadRecord(root, { required: false });
  const planRoot = record && record.status !== "landed" ? record.integrationWorktree : root;
  const plan = readText(path.join(planRoot, PATHS.plan)) ?? "";
  const inWave = record ? record.items.filter((i) => i.status !== "landed").map((i) => i.id) : [];
  const result = computeFrontier(plan, { exclude: [...exclude, ...inWave] });
  return { source: planRoot === root ? "main" : "integration", ...result };
}

// ---------------------------------------------------------------- setup

function resolveModels(root, extraArgs) {
  const candidates = [".claude/skills/models/scripts/resolve.mjs", ".agents/skills/models/scripts/resolve.mjs"]
    .map((p) => path.join(root, p))
    .concat(path.resolve(HERE, "../../models/scripts/resolve.mjs"));
  const script = candidates.find((p) => fs.existsSync(p));
  if (!script) stop("no-resolver", "The models resolver is not installed; run /doctor.");
  const args = extraArgs ? extraArgs.split(/\s+/).filter(Boolean) : [];
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) stop("models-invalid", (r.stderr || r.stdout).trim());
  return JSON.parse(r.stdout);
}

function nextWaveNumber(root, prefix) {
  const refs = gitTry(root, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${prefix}`]).out.split("\n");
  const nums = refs.map((r) => Number(r.slice(prefix.length))).filter((n) => Number.isInteger(n) && n > 0);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function planItems(text) {
  return new Map(parsePlan(text).items.map((i) => [i.id, i]));
}

function createItem(root, record, config, item, slot, install) {
  const repo = path.basename(root);
  const slug = kebab(item.title);
  const branch = `${config.git.featureBranchPrefix}${slug}`;
  const archives = (() => {
    try {
      return fs.readdirSync(path.join(record.integrationWorktree, PATHS.featuresDir));
    } catch {
      return [];
    }
  })().filter((f) => f.startsWith(`${paddedId(item.id)}-`));
  if (archives.length) {
    return { id: item.id, title: item.title, skipped: true, reason: `feature ${item.id} has an earlier build (${archives.join(", ")}); spec it with /feature to choose the attempt` };
  }
  if (gitTry(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok) {
    return { id: item.id, title: item.title, skipped: true, reason: `branch ${branch} already exists` };
  }
  const worktree = path.resolve(root, config.avengers.worktreeRoot, `${repo}-${slug}`);
  if (fs.existsSync(worktree)) return { id: item.id, title: item.title, skipped: true, reason: `${worktree} already exists` };
  const forkPoint = git(record.integrationWorktree, ["rev-parse", "HEAD"]);
  git(root, ["worktree", "add", "-q", "-b", branch, worktree, forkPoint]);
  const installed = install ? runShell(worktree, install) : null;
  return {
    id: item.id,
    title: item.title,
    branch,
    worktree,
    port: config.avengers.portBase + slot,
    forkPoint,
    buildAttempt: 1,
    status: "speccing",
    repairAttempts: 0,
    reviewTarget: null,
    landedCommit: null,
    blockedReason: installed && !installed.ok ? `install failed (exit ${installed.exitCode})` : null,
    question: null,
    ...(installed && !installed.ok ? { status: "blocked", installTail: installed.tail } : {})
  };
}

function freeSlots(record, count) {
  const used = new Set(
    record.items.filter((i) => !["landed", "dropped"].includes(i.status)).map((i) => i.port - record.portBase)
  );
  const slots = [];
  for (let s = 1; slots.length < count; s += 1) if (!used.has(s)) slots.push(s);
  return slots;
}

export function setup(cwd, { items, install, modelArgs }) {
  const pre = preflight(cwd);
  if (!pre.ready) stop("preflight", "Preflight failed.", { problems: pre.problems });
  const root = mainRoot(cwd);
  const config = readConfig(root);
  const ids = parseIds(items);
  if (!ids.length) throw new Error("--items is required");
  if (ids.length > config.avengers.maxConcurrent) stop("too-many", `At most ${config.avengers.maxConcurrent} items per wave.`);
  const onFrontier = new Set(pre.frontier.map((f) => f.id));
  const off = ids.filter((id) => !onFrontier.has(id));
  if (off.length) stop("not-on-frontier", `Items ${off.join(", ")} are not on the frontier.`);
  const models = resolveModels(root, modelArgs);

  ensureScratchIgnored(root);
  const prefix = config.avengers.integrationBranchPrefix;
  const n = nextWaveNumber(root, prefix);
  const integrationBranch = `${prefix}${n}`;
  const integrationWorktree = path.resolve(root, config.avengers.worktreeRoot, `${path.basename(root)}-wave-${n}`);
  git(root, ["worktree", "add", "-q", "-b", integrationBranch, integrationWorktree, pre.defaultBranch]);
  const installedIntegration = install ? runShell(integrationWorktree, install) : null;
  if (installedIntegration && !installedIntegration.ok) {
    stop("install-failed", `Install failed in the integration worktree: ${install}`, { tail: installedIntegration.tail });
  }

  const now = new Date().toISOString();
  const record = {
    schemaVersion: 1,
    wave: n,
    status: "speccing",
    defaultBranch: pre.defaultBranch,
    startCommit: pre.startCommit,
    integrationBranch,
    integrationWorktree,
    portBase: config.avengers.portBase,
    verifyCommand: pre.verifyCommand,
    startedAt: now,
    updatedAt: now,
    models: Object.fromEntries(
      Object.entries(models.roles).map(([role, r]) => [role, { model: r.model, family: r.family, effort: r.effort }])
    ),
    items: [],
    deferred: []
  };
  const plan = planItems(readText(path.join(integrationWorktree, PATHS.plan)) ?? "");
  const slots = freeSlots(record, ids.length);
  ids.forEach((id, i) => {
    const created = createItem(root, record, config, plan.get(id), slots[i], install);
    if (created.skipped) record.deferred.push({ id, reason: created.reason });
    else record.items.push(created);
  });
  saveRecord(root, record);
  return {
    wave: n,
    integrationBranch,
    integrationWorktree,
    startCommit: record.startCommit,
    verifyCommand: record.verifyCommand,
    models: record.models,
    warnings: models.warnings,
    items: record.items.map(brief),
    deferred: record.deferred
  };
}

export function add(cwd, { items, install }) {
  const root = mainRoot(cwd);
  const record = loadRecord(root);
  const config = readConfig(root);
  const ids = parseIds(items);
  const front = new Set(frontier(cwd).frontier.map((f) => f.id));
  const off = ids.filter((id) => !front.has(id));
  if (off.length) stop("not-on-frontier", `Items ${off.join(", ")} are not on the frontier.`);
  const active = record.items.filter((i) => !["landed", "dropped", "blocked"].includes(i.status)).length;
  if (active + ids.length > config.avengers.maxConcurrent) stop("capacity", `Only ${config.avengers.maxConcurrent - active} slots are free.`);
  const plan = planItems(readText(path.join(record.integrationWorktree, PATHS.plan)) ?? "");
  const slots = freeSlots(record, ids.length);
  const added = [];
  ids.forEach((id, i) => {
    record.deferred = record.deferred.filter((d) => d.id !== id);
    const created = createItem(root, record, config, plan.get(id), slots[i], install);
    if (created.skipped) record.deferred.push({ id, reason: created.reason });
    else {
      record.items.push(created);
      added.push(brief(created));
    }
  });
  if (record.status === "integrating" && added.length) record.status = "building";
  saveRecord(root, record);
  return { added, deferred: record.deferred };
}

function parseIds(value) {
  return String(value ?? "")
    .split(/[\s,]+/)
    .map(normalizeId)
    .filter(Boolean);
}

function brief(item) {
  return {
    id: item.id,
    title: item.title,
    branch: item.branch,
    worktree: item.worktree,
    port: item.port,
    forkPoint: item.forkPoint,
    status: item.status,
    ...(item.blockedReason ? { blockedReason: item.blockedReason } : {})
  };
}

// ---------------------------------------------------------------- state

const ITEM_STATUSES = new Set([
  "speccing", "awaiting-approval", "implementing", "verifying", "reviewing",
  "repairing", "ready-to-land", "landing", "landed", "blocked", "dropped"
]);
const WAVE_STATUSES = new Set(["speccing", "awaiting-approval", "building", "integrating", "ready-to-land", "landed", "blocked"]);

export function stateCommand(cwd, args) {
  const root = mainRoot(cwd);
  const record = loadRecord(root);
  const sub = args._[1];
  if (!sub) return { record };
  if (sub === "wave") {
    if (!WAVE_STATUSES.has(args.status)) throw new Error(`--status must be one of ${[...WAVE_STATUSES].join(", ")}`);
    record.status = args.status;
    saveRecord(root, record);
    return { wave: record.wave, status: record.status };
  }
  if (sub === "set") {
    const item = findItem(record, args.id);
    if (args.status) {
      if (!ITEM_STATUSES.has(args.status)) throw new Error(`--status must be one of ${[...ITEM_STATUSES].join(", ")}`);
      item.status = args.status;
      if (args.status !== "blocked") item.blockedReason = null;
      if (args.status !== "dropped") item.question = null;
    }
    if (args.reason !== undefined) item.blockedReason = args.reason;
    if (args.question !== undefined) item.question = args.question;
    if (args.repair !== undefined) item.repairAttempts = args.repair === "+1" ? item.repairAttempts + 1 : Number(args.repair);
    saveRecord(root, record);
    const limit = readConfig(root).continuous.maxRepairAttempts;
    return { item: brief(item), repairAttempts: item.repairAttempts, repairLimitReached: item.repairAttempts >= limit };
  }
  throw new Error(`Unknown state action ${sub}`);
}

// ---------------------------------------------------------------- verify and checkpoint

function itemWorktree(cwd, args) {
  const root = mainRoot(cwd);
  const record = loadRecord(root);
  if (args.integration) return { root, record, worktree: record.integrationWorktree, item: null };
  const item = findItem(record, args.id);
  return { root, record, worktree: item.worktree, item };
}

export function verify(cwd, args) {
  const { record, worktree, item } = itemWorktree(cwd, args);
  const env = item ? { PORT: String(item.port) } : {};
  const result = runShell(worktree, record.verifyCommand, { env });
  return { command: record.verifyCommand, worktree, head: git(worktree, ["rev-parse", "HEAD"]), ...result };
}

export function checkpoint(cwd, args) {
  const { root, record, worktree, item } = itemWorktree(cwd, args);
  const specPath = path.join(worktree, PATHS.spec);
  const specText = readText(specPath);
  const spec = parseSpec(specText);
  if (!spec || spec.kind !== "feature") stop("no-spec", "The item's worktree holds no feature spec.");
  if (spec.stepsChecked !== spec.steps || spec.steps === 0) {
    stop("steps-unchecked", `${spec.steps - spec.stepsChecked} of ${spec.steps} build steps are unchecked.`);
  }
  if (spec.status !== "verified") fs.writeFileSync(specPath, setSpecStatus(specText, "verified"));
  const changes = statusPaths(worktree).filter((p) => !isScratch(p.path));
  if (changes.length) {
    git(worktree, ["add", "-A", "--", "."]);
    git(worktree, ["commit", "--no-verify", "-q", "-m", `chore(review): checkpoint ${spec.title}`]);
  }
  const target = git(worktree, ["rev-parse", "HEAD"]);
  const files = git(worktree, ["diff", "--name-only", `${item.forkPoint}..${target}`]).split("\n").filter(Boolean);
  item.reviewTarget = target;
  item.status = "reviewing";
  saveRecord(root, record);
  return {
    id: item.id,
    worktree,
    base: item.forkPoint,
    baseRef: `refs/heads/${record.integrationBranch}`,
    target,
    committed: changes.length > 0,
    specSha256: sha256(fs.readFileSync(specPath)),
    files
  };
}

// ---------------------------------------------------------------- findings

export function findings(cwd, args) {
  const { worktree } = itemWorktree(cwd, args);
  const ledger = parseLedger(readText(path.join(worktree, PATHS.findings)));
  return {
    entries: ledger.entries.map((e) => ({ id: e.id, severity: e.severity, status: e.status, axis: e.axis, title: e.title })),
    malformed: ledger.malformed
  };
}

const AXES = new Set(["standards", "spec", "lens", "integration"]);

function oneLine(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.replace(/\s+/g, " ").trim();
}

export function renderFinding(num, finding, meta) {
  const sev = finding.severity;
  if (!/^P[0-3]$/.test(sev ?? "")) throw new Error(`severity must be P0-P3, got ${sev}`);
  const status = finding.status ?? "open";
  if (!["open", "unverified"].includes(status)) throw new Error("new findings are open or unverified");
  const effort = meta.effort ? `, effort ${meta.effort}` : "";
  return [
    `### F-${String(num).padStart(2, "0")} [${sev}] ${status} - ${oneLine(finding.title, "title")}`,
    "",
    `**File:** ${oneLine(finding.file, "file")}`,
    `**Found:** ${meta.date} by ${meta.reviewer} (${meta.model}${effort}), /avengers wave ${meta.wave}, review of \`${meta.base.slice(0, 7)}..${meta.target.slice(0, 7)}\``,
    `**Axis:** ${meta.axis}`,
    `**Why it matters:** ${oneLine(finding.why, "why")}`,
    `**Suggested fix:** ${oneLine(finding.fix, "fix")}`,
    "**Resolution:**"
  ].join("\n");
}

/**
 * Record reviewer results. Reviewers write JSON to
 * blueprint/.state/avengers/review-<axis>.json in the item's worktree; this
 * numbers the new findings, applies verdicts to `fixed` entries on the
 * reviewer's axis, and renames the input so it is never recorded twice.
 */
export function record(cwd, args) {
  const { record: wave, worktree, item } = args.integration
    ? itemWorktree(cwd, { integration: true })
    : itemWorktree(cwd, args);
  const scratch = path.join(worktree, SCRATCH_DIR);
  const inputs = args.from
    ? [].concat(args.from).map((f) => path.resolve(worktree, f))
    : (fs.existsSync(scratch) ? fs.readdirSync(scratch) : [])
        .filter((f) => /^review-[a-z]+\.json$/.test(f))
        .sort()
        .map((f) => path.join(scratch, f));
  if (!inputs.length) stop("no-review-output", "No reviewer output found in blueprint/.state/avengers/.");

  const ledgerPath = path.join(worktree, PATHS.findings);
  const ledgerText = readText(ledgerPath) ?? FINDINGS_STUB;
  let entries = parseLedger(ledgerText).entries;
  const added = [];
  const verdicts = [];
  const rejected = [];
  const target = item ? item.reviewTarget : git(worktree, ["rev-parse", "HEAD"]);
  const base = item ? item.forkPoint : wave.startCommit;
  const date = new Date().toISOString().slice(0, 10);

  // Validate every input before recording any, so a stop never half-records.
  const loaded = inputs.map((file) => {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      stop("bad-review-output", `${path.basename(file)} is not valid JSON.`);
    }
    if (!AXES.has(data.axis)) stop("bad-review-output", `${path.basename(file)} has an unknown axis.`);
    if (data.target && target && data.target !== target) {
      stop("stale-review-output", `${path.basename(file)} reviewed ${data.target}, not the current target ${target}.`, {
        file: path.relative(worktree, file)
      });
    }
    return { file, data };
  });

  for (const { file, data } of loaded) {
    const meta = {
      reviewer: oneLine(data.reviewer ?? `reviewer-${data.axis}`, "reviewer"),
      model: oneLine(data.model ?? "unknown (runtime did not expose exact model)", "model"),
      effort: data.effort ?? null,
      axis: data.axis,
      wave: wave.wave,
      base,
      target,
      date
    };
    for (const finding of data.findings ?? []) {
      const num = nextFindingNumber(entries);
      const body = renderFinding(num, finding, meta);
      const entry = parseLedger(body).entries[0];
      entries = [...entries, entry];
      added.push({ id: entry.id, severity: entry.severity, axis: data.axis, title: entry.title });
    }
    for (const v of data.verdicts ?? []) {
      const idx = entries.findIndex((e) => e.id === v.id);
      if (idx === -1) {
        rejected.push({ id: v.id, reason: "no such finding" });
        continue;
      }
      const e = entries[idx];
      if (e.status !== "fixed") {
        rejected.push({ id: v.id, reason: `status is ${e.status}, verdicts apply to fixed entries` });
        continue;
      }
      if (e.axis && e.axis !== data.axis && data.axis !== "lens") {
        rejected.push({ id: v.id, reason: `axis is ${e.axis}` });
        continue;
      }
      if (!["closed", "open", "invalid"].includes(v.status)) {
        rejected.push({ id: v.id, reason: `verdict ${v.status} is not closed, open or invalid` });
        continue;
      }
      entries[idx] = setEntryStatus(e, v.status, `${date} ${meta.reviewer} (${meta.model}) at \`${target.slice(0, 7)}\`: ${oneLine(v.evidence, "evidence")}`);
      verdicts.push({ id: v.id, status: v.status });
    }
    fs.renameSync(file, file.replace(/\.json$/, `.recorded-${Date.now()}.json`));
  }

  const firstEntry = ledgerText.search(/^### F-/m);
  const text = entries.length && firstEntry !== -1
    ? `${ledgerText.slice(0, firstEntry).replace(/\s*$/, "\n")}\n${entries.map((e) => e.body).join("\n\n")}\n`
    : renderLedger(entries);
  fs.writeFileSync(ledgerPath, text);
  const blocking = entries.filter((e) => ["P0", "P1"].includes(e.severity) && ["open", "fixed"].includes(e.status));
  return { added, verdicts, rejected, blocking: blocking.map((e) => e.id) };
}

// ---------------------------------------------------------------- gate and status

export function gate(cwd, args) {
  const { worktree, item } = itemWorktree(cwd, args);
  const blockers = [];
  const head = git(worktree, ["rev-parse", "HEAD"]);
  const spec = parseSpec(readText(path.join(worktree, PATHS.spec)));
  if (!spec || spec.kind !== "feature") blockers.push("no feature spec");
  else {
    if (spec.status !== "verified") blockers.push(`spec status is ${spec.status}`);
    if (spec.stepsChecked !== spec.steps) blockers.push("unchecked build steps");
  }
  const ledger = parseLedger(readText(path.join(worktree, PATHS.findings)));
  const blocking = ledger.entries.filter((e) => ["P0", "P1"].includes(e.severity) && ["open", "fixed"].includes(e.status));
  if (blocking.length) blockers.push(`blocking findings ${blocking.map((e) => `${e.id} ${e.status}`).join(", ")}`);
  if (ledger.malformed.length) blockers.push("malformed findings headers");
  if (ledger.entries.some((e) => e.num === null)) blockers.push("unnumbered findings");
  const receipt = parseReceipt(readText(path.join(worktree, PATHS.review)));
  if (receipt) {
    if (receipt.status !== "passed") blockers.push(`receipt ${receipt.status}`);
    if (receipt.target !== head) blockers.push("receipt target is not HEAD");
  } else if (args.lensRequired) blockers.push("lens review required but no receipt");
  if (item?.reviewTarget && item.reviewTarget !== head) blockers.push("HEAD moved since the review checkpoint");
  const dirty = statusPaths(worktree).filter((p) => ![PATHS.findings, PATHS.review].includes(p.path) && !isScratch(p.path));
  if (dirty.length) blockers.push(`uncommitted changes: ${dirty.map((p) => p.path).join(", ")}`);
  return {
    id: item?.id ?? null,
    pass: blockers.length === 0,
    blockers,
    head,
    receipt: receipt ? { status: receipt.status, target: receipt.target, reviewerModel: receipt.reviewerModel } : null,
    open: ledger.entries.filter((e) => ["open", "unverified", "fixed"].includes(e.status)).map((e) => `${e.id} [${e.severity}] ${e.status}`)
  };
}

export function status(cwd) {
  const root = mainRoot(cwd);
  const rec = loadRecord(root);
  const items = rec.items.map((i) => {
    const exists = fs.existsSync(i.worktree);
    const head = exists ? gitTry(i.worktree, ["rev-parse", "HEAD"]).out : null;
    const branchExists = gitTry(root, ["show-ref", "--verify", "--quiet", `refs/heads/${i.branch}`]).ok;
    return {
      id: i.id,
      title: i.title,
      status: i.status,
      head: head?.slice(0, 7) ?? null,
      worktree: exists,
      branch: branchExists,
      reviewTargetCurrent: i.reviewTarget ? i.reviewTarget === head : null,
      landedCommit: i.landedCommit,
      ...(i.blockedReason ? { blockedReason: i.blockedReason } : {}),
      ...(i.question ? { question: i.question } : {})
    };
  });
  const integrationTip = gitTry(root, ["rev-parse", rec.integrationBranch]).out || null;
  const defaultTip = gitTry(root, ["rev-parse", rec.defaultBranch]).out || null;
  return {
    wave: rec.wave,
    status: rec.status,
    integrationBranch: rec.integrationBranch,
    integrationTip,
    defaultBranchMoved: defaultTip !== rec.startCommit,
    items,
    deferred: rec.deferred
  };
}

/** Commit integration-audit evidence (ledger and receipt only) on the integration branch. */
export function commitEvidence(cwd) {
  const root = mainRoot(cwd);
  const rec = loadRecord(root);
  const wt = rec.integrationWorktree;
  const changed = statusPaths(wt).filter((p) => !isScratch(p.path));
  const other = changed.filter((p) => ![PATHS.findings, PATHS.review].includes(p.path));
  if (other.length) stop("integration-dirty", "The integration worktree has changes besides the ledger and receipt.", { files: other.map((p) => p.path) });
  if (!changed.length) return { committed: false };
  git(wt, ["add", "--", ...changed.map((p) => p.path)]);
  git(wt, ["commit", "--no-verify", "-q", "-m", "chore(review): record integration audit findings"]);
  const ledger = parseLedger(readText(path.join(wt, PATHS.findings))).entries;
  return {
    committed: true,
    commit: git(wt, ["rev-parse", "HEAD"]),
    blocking: ledger.filter((e) => ["P0", "P1"].includes(e.severity) && ["open", "fixed"].includes(e.status)).map((e) => e.id)
  };
}

export function close(cwd) {
  const root = mainRoot(cwd);
  const rec = loadRecord(root);
  const tip = git(root, ["rev-parse", rec.integrationBranch]);
  const landed = gitTry(root, ["merge-base", "--is-ancestor", tip, rec.defaultBranch]).ok;
  if (!landed) stop("not-landed", `${rec.integrationBranch} is not yet in ${rec.defaultBranch}.`);
  const removed = [];
  if (fs.existsSync(rec.integrationWorktree)) {
    const dirty = statusPaths(rec.integrationWorktree).filter((p) => !isScratch(p.path));
    if (dirty.length) stop("integration-dirty", "The integration worktree has uncommitted changes.");
    git(root, ["worktree", "remove", "--force", rec.integrationWorktree]);
    removed.push(rec.integrationWorktree);
  }
  git(root, ["branch", "-d", rec.integrationBranch]);
  fs.rmSync(recordPath(root), { force: true });
  const left = rec.items.filter((i) => i.status !== "landed" && fs.existsSync(i.worktree)).map((i) => ({ id: i.id, worktree: i.worktree, status: i.status }));
  return { removed, deletedBranch: rec.integrationBranch, keptItems: left };
}

// ---------------------------------------------------------------- CLI

const COMMANDS = {
  preflight: (a) => preflight(process.cwd(), a),
  frontier: (a) => frontier(process.cwd(), { exclude: parseIds(a.exclude) }),
  setup: (a) => setup(process.cwd(), a),
  add: (a) => add(process.cwd(), a),
  state: (a) => stateCommand(process.cwd(), a),
  verify: (a) => verify(process.cwd(), a),
  checkpoint: (a) => checkpoint(process.cwd(), a),
  findings: (a) => findings(process.cwd(), a),
  record: (a) => record(process.cwd(), a),
  gate: (a) => gate(process.cwd(), a),
  status: () => status(process.cwd()),
  "commit-evidence": () => commitEvidence(process.cwd()),
  close: () => close(process.cwd())
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = parseArgs(process.argv.slice(2), { flags: ["integration", "lensRequired", "help"], lists: ["from"] });
  const command = COMMANDS[args._[0]];
  if (!command || args.help) {
    const usage = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 20).map((l) => l.replace(/^\/\/ ?/, ""));
    process.stdout.write(`${usage.join("\n")}\n`);
    if (!command && !args.help) process.exitCode = 1;
  } else {
    runMain(() => command(args));
  }
}

export { REVIEW_STUB };
