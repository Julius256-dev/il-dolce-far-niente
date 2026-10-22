#!/usr/bin/env node
// Land one finished /avengers item onto the wave's integration branch.
//
// Reproduces /complete Steps 0-2 on the feature branch (landing: wave-merge),
// then squash-merges onto the integration branch, resolving only the Blueprint
// bookkeeping files (build plan ticks, findings ledger, overview fingerprint)
// deterministically. Any other conflict, or a failed Verify, restores both
// branches to their state before the run and stops with exit 2 so the merger
// agent can deal with it.
//
//   node land.mjs --worktree <feature> --integration-worktree <wave> \
//     --integration-branch wave/3 --fork-point <sha> [--lens-required] \
//     [--try-guide <file>] [--message "feat: ..."]
//   node land.mjs resolve --worktree <path>   resolve bookkeeping files of an
//                                              in-progress merge in any worktree
//
// Prints one JSON object. Never pushes and never touches the default branch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CURRENT_FEATURE_STUB,
  FINDINGS_STUB,
  PATHS,
  REVIEW_STUB,
  archiveRelPath,
  captureSourceTree,
  ensureScratchIgnored,
  kebab,
  commit,
  computeFrontier,
  currentBranch,
  findingPrefix,
  git,
  gitTry,
  normalizePlanMarkers,
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
  receiptArchiveSection,
  renderLedger,
  replaceSourceHash,
  runMain,
  runShell,
  setSpecStatus,
  sha256,
  showFile,
  statusPaths,
  stop,
  tickPlan,
  topLevel,
  unionLedgers,
  unionPlanTicks,
  writeAtomic
} from "./lib.mjs";

const SCRATCH = "blueprint/.state/avengers/";
const ALLOWED_DIRT = new Set([PATHS.findings, PATHS.review]);

export function isScratch(p) {
  return p.startsWith(SCRATCH);
}

// ---------------------------------------------------------------- phase A: /complete Steps 0-2

export function prepareCompletion(wt, opts) {
  const root = topLevel(wt);
  ensureScratchIgnored(root);
  const config = readConfig(root);
  const branch = currentBranch(root);
  if (!branch) stop("detached-head", "The feature worktree is not on a branch.");
  if (!branch.startsWith(config.git.featureBranchPrefix)) {
    stop("branch-prefix", `Branch ${branch} does not use the feature prefix ${config.git.featureBranchPrefix}.`);
  }
  if (branch === opts.integrationBranch) stop("wrong-worktree", "--worktree is the integration worktree.");

  const specPath = path.join(root, PATHS.spec);
  const specText = readText(specPath);
  const spec = parseSpec(specText);
  if (!spec || spec.kind !== "feature" || !spec.id) {
    stop("no-feature-spec", "current-feature.md does not hold a build-plan feature spec.");
  }
  if (spec.attempt === null) stop("build-attempt", "The spec needs exactly one positive **Build attempt:** field.");
  if (spec.statusFields !== 1) stop("spec-status", "The spec needs exactly one **Status:** field.");
  if (spec.steps === 0 || spec.stepsChecked !== spec.steps) {
    stop("steps-unchecked", `${spec.steps - spec.stepsChecked} of ${spec.steps} build steps are unchecked.`);
  }
  if (spec.branch && spec.branch !== branch) {
    stop("branch-mismatch", `Spec branch ${spec.branch} differs from the checked-out ${branch}.`);
  }

  // Unrelated dirty work blocks; the ledger and receipt are expected evidence.
  const dirty = statusPaths(root).filter((p) => !ALLOWED_DIRT.has(p.path) && !isScratch(p.path));
  if (dirty.length) {
    stop("dirty-worktree", "The feature worktree has changes outside the findings ledger and receipt.", {
      files: dirty.map((p) => `${p.code} ${p.path}`)
    });
  }
  if (gitTry(root, ["diff", "--name-only", "--diff-filter=U"]).out) stop("unmerged", "The feature worktree has unmerged files.");

  const head = git(root, ["rev-parse", "HEAD"]);
  const forkPoint = git(root, ["rev-parse", "--verify", `${opts.forkPoint}^{commit}`]);
  if (!gitTry(root, ["merge-base", "--is-ancestor", forkPoint, head]).ok) {
    stop("fork-point", `Fork point ${forkPoint} is not an ancestor of ${branch}.`);
  }

  // Findings gate.
  const ledgerText = readText(path.join(root, PATHS.findings));
  const ledger = parseLedger(ledgerText);
  if (ledger.malformed.length) stop("malformed-findings", "findings.md has malformed finding headers.", { lines: ledger.malformed });
  const blocking = ledger.entries.filter((e) => ["P0", "P1"].includes(e.severity) && ["open", "fixed"].includes(e.status));
  if (blocking.length) {
    stop("blocking-findings", "P0/P1 findings are open or fixed.", { findings: blocking.map((e) => `${e.id} [${e.severity}] ${e.status}`) });
  }
  const placeholders = ledger.entries.filter((e) => e.num === null);
  if (placeholders.length) stop("unnumbered-findings", "findings.md holds F-?? placeholders; record them first.");

  // Receipt gate.
  const reviewText = readText(path.join(root, PATHS.review));
  const receipt = parseReceipt(reviewText);
  let finalSpec = specText;
  if (receipt) {
    if (receipt.status !== "passed") stop("receipt-not-passed", `The independent review is ${receipt.status ?? "malformed"}.`);
    if (receipt.target !== head) stop("receipt-stale", `Receipt target ${receipt.target} is not HEAD ${head}.`);
    if (receipt.specHash !== sha256(Buffer.from(specText, "utf8"))) stop("receipt-spec", "The spec changed after the independent review.");
    if (spec.status !== "verified") stop("receipt-spec-status", "A passing receipt requires the spec to be verified already.");
    if (receipt.baseCommit && !gitTry(root, ["merge-base", "--is-ancestor", receipt.baseCommit, head]).ok) {
      stop("receipt-base", "The receipt's base commit is not an ancestor of HEAD.");
    }
  } else if (opts.lensRequired) {
    stop("receipt-missing", "Lens review was required but review.md holds no receipt.");
  } else if (reviewText !== null && reviewText !== REVIEW_STUB) {
    stop("review-not-stub", "review.md is neither the canonical stub nor a receipt.");
  } else {
    finalSpec = setSpecStatus(specText, "verified");
  }

  // Verify (Step 0 requires it in this session).
  const agentsText = readText(path.join(root, PATHS.agents));
  const verifyCommand = parseVerifyCommand(agentsText);
  if (!verifyCommand) stop("no-verify", "AGENTS.md declares no Verify command; run /ci.");
  const verify = runShell(root, verifyCommand, { env: opts.env });
  if (!verify.ok) stop("verify-failed-feature", `Verify failed in the feature worktree: ${verifyCommand}`, { verify });

  // Archive destination and build history.
  const archiveRel = archiveRelPath(spec.id, kebab(spec.title), spec.attempt);
  const archiveAbs = path.join(root, archiveRel);
  if (fs.existsSync(archiveAbs)) stop("archive-exists", `${archiveRel} already exists; resolve with /complete recovery.`);
  const priorSameAttempt = listArchives(root).filter((f) => {
    const m = f.match(/^(\d+[a-z]?)-.*?(?:--build-(\d+))?\.md$/);
    return m && m[1] === paddedId(spec.id) && Number(m[2] ?? 1) === spec.attempt;
  });
  if (priorSameAttempt.length) {
    stop("prior-build", `Build ${spec.attempt} of feature ${spec.id} is already archived as ${priorSameAttempt.join(", ")}.`);
  }

  // Snapshot every file we are about to change, so a later failure restores them.
  const touched = [PATHS.spec, PATHS.findings, PATHS.review, PATHS.plan, PATHS.overview];
  const snapshot = new Map(touched.map((rel) => [rel, readBuf(path.join(root, rel))]));
  snapshot.set(PATHS.spec, Buffer.from(specText, "utf8"));
  const restore = () => {
    for (const [rel, buf] of snapshot) {
      const abs = path.join(root, rel);
      if (buf === null) fs.rmSync(abs, { force: true });
      else fs.writeFileSync(abs, buf);
    }
    fs.rmSync(archiveAbs, { force: true });
  };

  try {
    // Source tree and optional-file absence, before any logging edit.
    if (finalSpec !== specText) fs.writeFileSync(specPath, finalSpec);
    const sourceTree = captureSourceTree(root);
    const absentOptional = [PATHS.findings, PATHS.review].filter((rel) => {
      try {
        fs.lstatSync(path.join(root, rel));
        return false;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return !gitTry(root, ["cat-file", "-e", `HEAD:${rel}`]).ok && !gitTry(root, ["cat-file", "-e", `${sourceTree}:${rel}`]).ok;
    });

    const specBuf = Buffer.from(finalSpec, "utf8");
    const annotation = {
      schemaVersion: 2,
      specBytes: specBuf.length,
      specSha256: sha256(specBuf),
      branch: `refs/heads/${branch}`,
      head,
      baseRef: `refs/heads/${opts.integrationBranch}`,
      baseCommit: forkPoint,
      sourceTree,
      landing: "wave-merge",
      absentOptional
    };

    const resolved = ledger.entries.filter((e) => ["closed", "accepted", "invalid"].includes(e.status));
    const remaining = ledger.entries.filter((e) => !["closed", "accepted", "invalid"].includes(e.status));
    const prefix = findingPrefix(spec.id, spec.attempt);
    const sections = [];
    if (resolved.length) {
      sections.push(
        `## Findings\n\n${resolved.map((e) => e.body.replace(/^### (F-\d+) /, `### ${prefix}/$1 `)).join("\n\n")}\n`
      );
    }
    if (receipt) sections.push(receiptArchiveSection(reviewText));
    const tryGuide = readTryGuide(root, opts.tryGuide);
    if (tryGuide) sections.push(tryGuide);
    const archive = Buffer.concat([
      specBuf,
      Buffer.from(`\n\n<!-- blueprint:completion ${JSON.stringify(annotation)} -->\n`, "utf8"),
      Buffer.from(sections.length ? `\n${sections.join("\n")}` : "", "utf8")
    ]);

    writeAtomic(archiveAbs, archive);
    if (!fs.readFileSync(archiveAbs).equals(archive)) stop("archive-readback", "The archive did not read back byte for byte.");

    const planAbs = path.join(root, PATHS.plan);
    const planText = readText(planAbs);
    if (planText === null) stop("no-build-plan", "blueprint/build-plan.md is missing.");
    fs.writeFileSync(planAbs, tickPlan(planText, spec.id));
    refreshOverviewHash(root);

    const removedAny = resolved.length > 0;
    if (!remaining.length) fs.writeFileSync(path.join(root, PATHS.findings), FINDINGS_STUB);
    else if (removedAny) fs.writeFileSync(path.join(root, PATHS.findings), keepEntries(ledgerText, remaining));
    fs.writeFileSync(path.join(root, PATHS.review), REVIEW_STUB);
    fs.writeFileSync(specPath, CURRENT_FEATURE_STUB);
    if (readText(specPath) !== CURRENT_FEATURE_STUB || readText(path.join(root, PATHS.review)) !== REVIEW_STUB) {
      stop("stub-readback", "A reset stub did not read back exactly.");
    }

    const message = opts.message ?? `feat: ${spec.title}`;
    git(root, ["add", "-A", "--", "."]);
    git(root, ["commit", "--no-verify", "-q", "-m", message]);
    const workCommit = git(root, ["rev-parse", "HEAD"]);
    return {
      root,
      branch,
      head,
      forkPoint,
      spec,
      archiveRel,
      archive,
      workCommit,
      message,
      verifyCommand,
      verify,
      findings: { archived: resolved.map((e) => `${prefix}/${e.id}`), carried: remaining.map((e) => e.id) },
      receipt: Boolean(receipt),
      tryGuide: Boolean(tryGuide),
      undo: () => {
        git(root, ["reset", "-q", "--hard", head]);
        restore();
      }
    };
  } catch (error) {
    restore();
    throw error;
  }
}

function listArchives(root) {
  try {
    return fs.readdirSync(path.join(root, PATHS.featuresDir)).filter((f) => f.endsWith(".md") && f !== "README.md");
  } catch {
    return [];
  }
}

function readBuf(abs) {
  try {
    return fs.readFileSync(abs);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function readTryGuide(root, explicit) {
  const file = explicit ?? path.join(root, SCRATCH, "try-guide.md");
  const text = readText(path.isAbsolute(file) ? file : path.join(root, file));
  if (text === null) {
    if (explicit) stop("try-guide-missing", `Try guide ${explicit} does not exist.`);
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("## Try it now")) stop("try-guide-format", "The try guide must start with `## Try it now`.");
  return `${trimmed}\n`;
}

/** Keep the ledger's own header bytes and the remaining entries verbatim. */
function keepEntries(ledgerText, remaining) {
  const firstEntry = ledgerText.search(/^### F-/m);
  const header = ledgerText.slice(0, firstEntry).replace(/\s*$/, "\n");
  return `${header}\n${remaining.map((e) => e.body).join("\n\n")}\n`;
}

export function refreshOverviewHash(root) {
  const overviewAbs = path.join(root, PATHS.overview);
  const overview = readText(overviewAbs);
  if (overview === null) return false;
  const projectPlan = readBuf(path.join(root, PATHS.projectPlan));
  const buildPlan = readBuf(path.join(root, PATHS.plan));
  if (projectPlan === null || buildPlan === null) return false;
  const next = replaceSourceHash(overview, overviewHash(projectPlan, buildPlan));
  if (next === null) return false;
  if (next !== overview) fs.writeFileSync(overviewAbs, next);
  return true;
}

// ---------------------------------------------------------------- bookkeeping resolution

/**
 * Resolve the Blueprint bookkeeping files after a merge (or squash merge) left
 * them with conflicts or with two independent edits. base/ours/theirs are revs.
 * Returns the files still conflicted afterwards.
 */
export function resolveBookkeeping(root, { base, ours, theirs, theirsBranch }) {
  const unmerged = () => new Set(gitTry(root, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean));
  const conflicted = unmerged();
  const notes = [];
  const read = (rev, rel) => showFile(root, rev, rel)?.toString("utf8") ?? null;

  // Build plan: keep every tick from both sides when nothing else differs.
  {
    const o = read(ours, PATHS.plan);
    const t = read(theirs, PATHS.plan);
    if (o !== null && t !== null && o !== t) {
      const merged = unionPlanTicks(o, t);
      if (merged !== null) {
        writeResolved(root, PATHS.plan, merged);
        notes.push("build-plan ticks merged");
      } else if (!conflicted.has(PATHS.plan)) {
        const current = readText(path.join(root, PATHS.plan));
        const promoted = promoteOnly(current);
        if (promoted !== current) writeResolved(root, PATHS.plan, promoted);
      }
    }
  }

  // Findings ledger: three-way union by finding ID.
  let renumbered = [];
  {
    const b = read(base, PATHS.findings);
    const o = read(ours, PATHS.findings);
    const t = read(theirs, PATHS.findings);
    if (o !== t && o !== null && t !== null) {
      const result = unionLedgers(b ?? FINDINGS_STUB, o, t, { branch: theirsBranch });
      if (!result.conflicts.length) {
        writeResolved(root, PATHS.findings, result.text);
        renumbered = result.renumbered;
        notes.push("findings ledger merged");
      }
    }
  }

  // Generated stubs: both sides reset them, so any conflict takes ours.
  for (const rel of [PATHS.review, PATHS.spec]) {
    if (conflicted.has(rel)) {
      const o = read(ours, rel);
      const t = read(theirs, rel);
      const stub = rel === PATHS.review ? REVIEW_STUB : CURRENT_FEATURE_STUB;
      if (o === stub && t === stub) writeResolved(root, rel, stub);
    }
  }

  // Overview: only the fingerprint may differ; recompute it from the merged plans.
  {
    const o = read(ours, PATHS.overview);
    const t = read(theirs, PATHS.overview);
    if (conflicted.has(PATHS.overview) && o !== null && t !== null && stripHash(o) === stripHash(t)) {
      writeResolved(root, PATHS.overview, o);
    }
    if (!unmerged().has(PATHS.overview) && refreshOverviewHash(root)) git(root, ["add", "--", PATHS.overview]);
  }

  // Additive conflicts: when both sides only inserted lines (an index of
  // re-exports, a route list), keep both. Anything with a deletion or rewrite
  // on either side stays for the merger.
  for (const rel of unmerged()) {
    if (Object.values(PATHS).includes(rel)) continue;
    if (!insertOnly(root, base, ours, rel) || !insertOnly(root, base, theirs, rel)) continue;
    const blobs = [ours, base, theirs].map((rev) => showFile(root, rev, rel));
    if (blobs.some((b) => b === null)) continue;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avengers-union-"));
    try {
      const files = ["ours", "base", "theirs"].map((name, i) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, blobs[i]);
        return file;
      });
      const merged = gitTry(root, ["merge-file", "-p", "--union", ...files]).out;
      writeResolved(root, rel, merged.endsWith("\n") || merged === "" ? merged : `${merged}\n`);
      notes.push(`additive union: ${rel}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  return { remaining: [...unmerged()], notes, renumbered };
}

function insertOnly(root, from, to, rel) {
  const r = gitTry(root, ["diff", "--numstat", from, to, "--", rel]);
  if (!r.ok || !r.out) return false;
  const [added, deleted] = r.out.split("\t");
  return deleted === "0" && Number(added) > 0;
}

function promoteOnly(text) {
  // Tick parents whose sub-items are all checked, without ticking anything else.
  const { items } = parsePlan(text);
  const leaf = items.find((i) => i.children.length === 0 && i.checked);
  return leaf ? tickPlan(text, leaf.id) : text;
}

function stripHash(text) {
  return text.replace(/<!-- blueprint:source-hash [0-9a-f]{64} -->/, "");
}

function writeResolved(root, rel, text) {
  fs.writeFileSync(path.join(root, rel), text);
  git(root, ["add", "--", rel]);
}

// ---------------------------------------------------------------- phase B: integration

export function landOnIntegration(prepared, opts) {
  const iroot = topLevel(opts.integrationWorktree);
  const ibranch = currentBranch(iroot);
  if (ibranch !== opts.integrationBranch) stop("integration-branch", `The integration worktree is on ${ibranch}, not ${opts.integrationBranch}.`);
  const dirty = statusPaths(iroot).filter((p) => !isScratch(p.path));
  if (dirty.length) stop("integration-dirty", "The integration worktree is not clean.", { files: dirty.map((p) => `${p.code} ${p.path}`) });
  const before = git(iroot, ["rev-parse", "HEAD"]);
  if (!gitTry(iroot, ["merge-base", "--is-ancestor", prepared.forkPoint, before]).ok) {
    stop("fork-point-integration", "The fork point is not on the integration branch.");
  }

  const squash = gitTry(iroot, ["merge", "--squash", prepared.branch]);
  const resolution = resolveBookkeeping(iroot, {
    base: prepared.forkPoint,
    ours: "HEAD",
    theirs: prepared.workCommit,
    theirsBranch: prepared.branch
  });
  if (resolution.remaining.length) {
    git(iroot, ["reset", "-q", "--hard", "HEAD"]);
    return { conflict: resolution.remaining };
  }

  if (gitTry(iroot, ["diff", "--cached", "--quiet"]).ok) {
    git(iroot, ["reset", "-q", "--hard", "HEAD"]);
    stop("squash-failed", "The squash merge staged nothing.", { git: squash.err?.trim() });
  }
  git(iroot, ["commit", "--no-verify", "-q", "-m", prepared.message]);
  const landed = git(iroot, ["rev-parse", "HEAD"]);
  const parents = git(iroot, ["rev-list", "--parents", "-n", "1", landed]).split(" ").slice(1);
  if (parents.length !== 1 || parents[0] !== before) {
    git(iroot, ["reset", "-q", "--hard", before]);
    stop("squash-shape", "The squash commit does not have the previous integration tip as its only parent.");
  }

  const verify = runShell(iroot, prepared.verifyCommand, { env: opts.env });
  if (!verify.ok) {
    git(iroot, ["reset", "-q", "--hard", before]);
    return { verifyFailed: verify };
  }

  // Archive proof: the tip carries the archive unchanged and the item ticked.
  const atTip = showFile(iroot, "HEAD", prepared.archiveRel);
  const plan = showFile(iroot, "HEAD", PATHS.plan)?.toString("utf8") ?? "";
  const ticked = parsePlan(plan).items.find((i) => i.id === prepared.spec.id)?.checked;
  if (!atTip || !atTip.equals(prepared.archive) || !ticked) {
    git(iroot, ["reset", "-q", "--hard", before]);
    stop("archive-proof", "The integration tip does not carry the archive unchanged with the item ticked.");
  }
  return { landed, before, verify, resolution, plan };
}

function removeFeature(prepared, iroot) {
  const leftovers = statusPaths(prepared.root).filter((p) => !isScratch(p.path));
  if (leftovers.length) return { removed: false, reason: "feature worktree not clean" };
  git(iroot, ["worktree", "remove", "--force", prepared.root]);
  git(iroot, ["branch", "-D", prepared.branch]);
  return { removed: true };
}

function updateWaveRecord(iroot, prepared, landed) {
  const main = git(iroot, ["worktree", "list", "--porcelain"]).split("\n")[0].replace(/^worktree /, "");
  const file = path.join(main, PATHS.wave);
  const text = readText(file);
  if (text === null) return false;
  const record = JSON.parse(text);
  const item = record.items?.find((i) => i.branch === prepared.branch);
  if (!item) return false;
  Object.assign(item, { status: "landed", landedCommit: landed, blockedReason: null });
  record.updatedAt = new Date().toISOString();
  writeAtomic(file, `${JSON.stringify(record, null, 2)}\n`);
  return true;
}

export async function land(opts) {
  for (const key of ["worktree", "integrationWorktree", "integrationBranch", "forkPoint"]) {
    if (!opts[key]) throw new Error(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  }
  const prepared = prepareCompletion(opts.worktree, opts);
  let result;
  try {
    result = landOnIntegration(prepared, opts);
  } catch (error) {
    prepared.undo();
    throw error;
  }
  if (result.conflict || result.verifyFailed) {
    prepared.undo();
    if (result.conflict) {
      stop("conflict", "Squash-merge conflicts outside the bookkeeping files. Both branches are back to their state before landing.", {
        files: result.conflict,
        next: "Merge the integration branch into the feature branch, resolve, run `land.mjs resolve` for bookkeeping files, Verify, then send the item back through review."
      });
    }
    stop("verify-failed-integration", `Verify failed on the integration branch: ${prepared.verifyCommand}. Both branches are back to their state before landing.`, {
      verify: result.verifyFailed
    });
  }
  const iroot = topLevel(opts.integrationWorktree);
  const cleanup = removeFeature(prepared, iroot);
  const recorded = updateWaveRecord(iroot, prepared, result.landed);
  const next = computeFrontier(result.plan);
  return {
    item: prepared.spec.id,
    title: prepared.spec.title,
    branch: prepared.branch,
    archive: prepared.archiveRel,
    workCommit: prepared.workCommit,
    integrationCommit: result.landed,
    verify: { feature: summarize(prepared.verify), integration: summarize(result.verify) },
    findings: prepared.findings,
    renumbered: result.resolution.renumbered,
    bookkeeping: result.resolution.notes,
    receiptArchived: prepared.receipt,
    tryGuideArchived: prepared.tryGuide,
    worktreeRemoved: cleanup.removed,
    waveRecordUpdated: recorded,
    frontier: next.frontier.map((i) => i.id)
  };
}

function summarize(v) {
  return v.ok ? `passed (${v.seconds}s)` : "failed";
}

export async function resolveCommand(opts) {
  const root = topLevel(opts.worktree);
  const mergeHead = gitTry(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  if (!mergeHead.ok) stop("no-merge", "No merge is in progress in this worktree.");
  const base = git(root, ["merge-base", "HEAD", "MERGE_HEAD"]);
  const theirsBranch = gitTry(root, ["name-rev", "--name-only", "MERGE_HEAD"]).out || "MERGE_HEAD";
  const r = resolveBookkeeping(root, { base, ours: "HEAD", theirs: "MERGE_HEAD", theirsBranch });
  return { remaining: r.remaining, resolved: r.notes, renumbered: r.renumbered };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = parseArgs(process.argv.slice(2), { flags: ["lensRequired", "help"] });
  if (args.help) {
    process.stdout.write(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 17).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
  } else if (args._[0] === "resolve") {
    runMain(() => resolveCommand(args));
  } else {
    runMain(() => land(args));
  }
}

export { normalizePlanMarkers };
