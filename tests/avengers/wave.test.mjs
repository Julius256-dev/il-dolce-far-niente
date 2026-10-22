import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  CURRENT_FEATURE_STUB,
  REVIEW_STUB,
  overviewHash,
  parseLedger,
  sha256
} from "../../skills/avengers/scripts/lib.mjs";
import { build, finding, g, project, scriptsDir } from "./fixture.mjs";

function run(cwd, script, args) {
  const r = spawnSync(process.execPath, [path.join(scriptsDir, script), ...args], { cwd, encoding: "utf8" });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // leave null
  }
  return { code: r.status, json, stderr: r.stderr, stdout: r.stdout };
}

const av = (cwd, ...args) => run(cwd, "avengers.mjs", args);
const land = (cwd, ...args) => run(cwd, "land.mjs", args);

function startWave(t, items = "1,2") {
  const { root, parent } = project(t);
  const pre = av(root, "preflight");
  assert.equal(pre.code, 0, pre.stdout + pre.stderr);
  assert.equal(pre.json.ready, true, JSON.stringify(pre.json.problems));
  const setup = av(root, "setup", "--items", items);
  assert.equal(setup.code, 0, setup.stdout + setup.stderr);
  return { root, parent, wave: setup.json };
}

function item(wave, id) {
  return wave.items.find((i) => i.id === id);
}

function landArgs(wave, it, extra = []) {
  return [
    "--worktree", it.worktree,
    "--integration-worktree", wave.integrationWorktree,
    "--integration-branch", wave.integrationBranch,
    "--fork-point", it.forkPoint,
    ...extra
  ];
}

function writeReview(wt, axis, target, body) {
  const dir = path.join(wt, "blueprint/.state/avengers");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `review-${axis}.json`), JSON.stringify({ axis, target, reviewer: `reviewer-${axis}`, model: "claude-opus-5-5", effort: "medium", ...body }));
}

test("preflight reports problems instead of starting", (t) => {
  const { root } = project(t);
  fs.writeFileSync(path.join(root, "blueprint/context/current-feature.md"), "# Feature: busy\n");
  const pre = av(root, "preflight");
  assert.equal(pre.json.ready, false);
  assert.match(pre.json.problems.join(" "), /active work/);
  assert.deepEqual(pre.json.frontier.map((f) => f.id), ["1", "2"]);
  const setup = av(root, "setup", "--items", "1");
  assert.equal(setup.code, 2);
  assert.equal(setup.json.stop, "preflight");
});

test("setup creates the integration branch, worktrees, ports and record", (t) => {
  const { root, wave } = startWave(t);
  assert.equal(wave.integrationBranch, "wave/1");
  assert.equal(wave.items.length, 2);
  assert.deepEqual(wave.items.map((i) => [i.branch, i.port]), [["feature/alpha-thing", 4101], ["feature/beta-thing", 4102]]);
  assert.equal(wave.models.implementer.model, "claude-sonnet-5-5");
  for (const it of wave.items) assert.ok(fs.existsSync(it.worktree));
  assert.equal(g(root, "rev-parse", "wave/1"), g(root, "rev-parse", "main"));
  const status = av(root, "status").json;
  assert.equal(status.items.length, 2);
  assert.equal(status.defaultBranchMoved, false);
  const front = av(root, "frontier").json;
  assert.equal(front.source, "integration");
  assert.deepEqual(front.frontier, []);
  assert.equal(av(root, "setup", "--items", "1").json.stop, "preflight");
});

test("checkpoint, record and gate run the review bookkeeping", (t) => {
  const { root, wave } = startWave(t);
  const a = item(wave, "1");
  build(a.worktree, { id: "1", title: "Alpha thing", branch: a.branch, file: "a.txt", content: "alpha\n" });
  const cp = av(root, "checkpoint", "--id", "1").json;
  assert.equal(cp.base, a.forkPoint);
  assert.equal(cp.committed, true);
  assert.deepEqual(cp.files.sort(), ["a.txt", "blueprint/context/current-feature.md"]);
  assert.match(fs.readFileSync(path.join(a.worktree, "blueprint/context/current-feature.md"), "utf8"), /\*\*Status:\*\* verified/);

  writeReview(a.worktree, "standards", cp.target, {
    findings: [{ severity: "P1", title: "Broken thing", file: "a.txt:1", why: "it breaks", fix: "mend it" }]
  });
  writeReview(a.worktree, "spec", cp.target, {
    findings: [{ severity: "P3", title: "Tiny nit", file: "a.txt:1", why: "style", fix: "tidy" }]
  });
  const rec = av(root, "record", "--id", "1").json;
  assert.deepEqual(rec.added.map((f) => [f.id, f.severity, f.axis]), [["F-01", "P3", "spec"], ["F-02", "P1", "standards"]]);
  assert.deepEqual(rec.blocking, ["F-02"]);
  assert.equal(av(root, "record", "--id", "1").json.stop, "no-review-output");
  const ledgerPath = path.join(a.worktree, "blueprint/context/findings.md");
  assert.match(fs.readFileSync(ledgerPath, "utf8"), /\*\*Found:\*\* \d{4}-\d{2}-\d{2} by reviewer-standards \(claude-opus-5-5, effort medium\), \/avengers wave 1/);

  const g1 = av(root, "gate", "--id", "1").json;
  assert.equal(g1.pass, false);
  assert.match(g1.blockers.join(" "), /blocking findings F-02 open/);

  // Repair: the implementer marks it fixed; the standards reviewer closes it on the new target.
  fs.writeFileSync(ledgerPath, fs.readFileSync(ledgerPath, "utf8").replace("F-02 [P1] open", "F-02 [P1] fixed"));
  fs.writeFileSync(path.join(a.worktree, "a.txt"), "alpha mended\n");
  g(a.worktree, "commit", "-qam", "fix: mend");
  const cp2 = av(root, "checkpoint", "--id", "1").json;
  assert.notEqual(cp2.target, cp.target);
  writeReview(a.worktree, "standards", cp2.target, { verdicts: [{ id: "F-02", status: "closed", evidence: "a.txt now mended" }] });
  writeReview(a.worktree, "spec", cp.target, { verdicts: [{ id: "F-01", status: "closed", evidence: "wrong" }] });
  const stale = av(root, "record", "--id", "1").json;
  assert.equal(stale.stop, "stale-review-output");
  assert.match(fs.readFileSync(ledgerPath, "utf8"), /F-02 \[P1\] fixed/, "nothing half-recorded");
  fs.rmSync(path.join(a.worktree, stale.file));
  const rec2 = av(root, "record", "--id", "1").json;
  assert.deepEqual(rec2.verdicts, [{ id: "F-02", status: "closed" }]);
  assert.deepEqual(rec2.blocking, []);
  const g2 = av(root, "gate", "--id", "1").json;
  assert.equal(g2.pass, true, g2.blockers.join("; "));
  assert.equal(av(root, "verify", "--id", "1").json.ok, true);
});

test("land archives like /complete, squashes onto the wave and unions the ledgers", (t) => {
  const { root, wave } = startWave(t);
  const a = item(wave, "1");
  const b = item(wave, "2");
  build(a.worktree, { id: "1", title: "Alpha thing", branch: a.branch, file: "a.txt", content: "alpha\n" });
  build(b.worktree, { id: "2", title: "Beta thing", branch: b.branch, file: "b.txt", content: "beta\n" });

  // Item 1: one closed finding (archived) and one open P3 (carried).
  const header = fs.readFileSync(path.join(a.worktree, "blueprint/context/findings.md"), "utf8").split("_No findings")[0];
  fs.writeFileSync(
    path.join(a.worktree, "blueprint/context/findings.md"),
    `${header}${finding("F-01", "P1", "closed", "Was broken")}\n\n${finding("F-02", "P3", "open", "Alpha nit")}\n`
  );
  av(root, "checkpoint", "--id", "1");
  // Item 2: an open P2 whose bare ID clashes with item 1's carried F-02.
  fs.writeFileSync(path.join(b.worktree, "blueprint/context/findings.md"), `${header}${finding("F-01", "P2", "open", "Beta first")}\n\n${finding("F-02", "P2", "open", "Beta second")}\n`);
  fs.mkdirSync(path.join(b.worktree, "blueprint/.state/avengers"), { recursive: true });
  fs.writeFileSync(path.join(b.worktree, "blueprint/.state/avengers/try-guide.md"), "## Try it now\n\nRun or do:\n\n`cat b.txt`\n\nExpected:\n\n`beta`\n\nThis proves:\n\nb.txt exists.\n");
  av(root, "checkpoint", "--id", "2");

  const headA = g(a.worktree, "rev-parse", "HEAD");
  const r1 = land(root, ...landArgs(wave, a));
  assert.equal(r1.code, 0, r1.stdout + r1.stderr);
  assert.deepEqual(r1.json.findings, { archived: ["1/F-01"], carried: ["F-02"] });
  assert.equal(r1.json.worktreeRemoved, true);
  assert.equal(r1.json.waveRecordUpdated, true);
  assert.ok(!fs.existsSync(a.worktree));
  assert.equal(spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/feature/alpha-thing"], { cwd: root }).status, 1);

  const iwt = wave.integrationWorktree;
  const archive = fs.readFileSync(path.join(iwt, "blueprint/history/features/01-alpha-thing.md"));
  const text = archive.toString("utf8");
  const marker = text.indexOf("\n\n<!-- blueprint:completion ");
  const annotation = JSON.parse(text.slice(marker).match(/<!-- blueprint:completion (\{.*\}) -->/)[1]);
  const specBytes = archive.subarray(0, marker);
  assert.equal(annotation.schemaVersion, 2);
  assert.equal(annotation.landing, "wave-merge");
  assert.equal(annotation.baseRef, "refs/heads/wave/1");
  assert.equal(annotation.baseCommit, a.forkPoint);
  assert.equal(annotation.head, headA);
  assert.equal(annotation.branch, "refs/heads/feature/alpha-thing");
  assert.equal(annotation.specBytes, specBytes.length);
  assert.equal(annotation.specSha256, sha256(specBytes));
  assert.deepEqual(annotation.absentOptional, []);
  assert.match(text, /## Findings\n\n### 1\/F-01 \[P1\] closed - Was broken/);
  assert.doesNotMatch(text, /Alpha nit/);
  assert.match(specBytes.toString(), /\*\*Status:\*\* verified/);

  // Integration commit: one parent, conventional message, no attribution trailer.
  const msg = g(iwt, "log", "-1", "--format=%B");
  assert.equal(msg, "feat: Alpha thing");
  assert.equal(g(iwt, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 2);

  // Item 2 lands on top: ticks union, ledger union with renumbering, try guide archived.
  const r2 = land(root, ...landArgs(wave, b));
  assert.equal(r2.code, 0, r2.stdout + r2.stderr);
  assert.deepEqual(r2.json.renumbered, [{ from: "F-02", to: "F-03" }]);
  assert.equal(r2.json.tryGuideArchived, true);
  const plan = fs.readFileSync(path.join(iwt, "blueprint/build-plan.md"), "utf8");
  assert.match(plan, /- \[x\] 1\./);
  assert.match(plan, /- \[x\] 2\./);
  assert.deepEqual(r2.json.frontier, ["3a", "3b"]);
  const ledger = parseLedger(fs.readFileSync(path.join(iwt, "blueprint/context/findings.md"), "utf8")).entries;
  assert.deepEqual(ledger.map((e) => `${e.id} ${e.title}`), ["F-01 Beta first", "F-02 Alpha nit", "F-03 Beta second"]);
  assert.equal(fs.readFileSync(path.join(iwt, "blueprint/context/current-feature.md"), "utf8"), CURRENT_FEATURE_STUB);
  assert.equal(fs.readFileSync(path.join(iwt, "blueprint/context/review.md"), "utf8"), REVIEW_STUB);
  const overview = fs.readFileSync(path.join(iwt, "blueprint/context/project-overview.md"), "utf8");
  const expected = overviewHash(fs.readFileSync(path.join(iwt, "blueprint/project-plan.md")), Buffer.from(plan));
  assert.match(overview, new RegExp(expected));
  assert.match(fs.readFileSync(path.join(iwt, "blueprint/history/features/02-beta-thing.md"), "utf8"), /\n## Try it now\n/);
  assert.equal(g(root, "rev-parse", "main"), wave.startCommit, "main never moves");
  const status = av(root, "status").json;
  assert.deepEqual(status.items.map((i) => i.status), ["landed", "landed"]);
});

test("land refuses blocking findings and stale receipts without changing anything", (t) => {
  const { root, wave } = startWave(t, "1");
  const a = item(wave, "1");
  build(a.worktree, { id: "1", title: "Alpha thing", branch: a.branch, file: "a.txt", content: "alpha\n" });
  av(root, "checkpoint", "--id", "1");
  const header = fs.readFileSync(path.join(a.worktree, "blueprint/context/findings.md"), "utf8").split("_No findings")[0];
  fs.writeFileSync(path.join(a.worktree, "blueprint/context/findings.md"), `${header}${finding("F-01", "P0", "fixed", "Danger")}\n`);
  const head = g(a.worktree, "rev-parse", "HEAD");
  const r = land(root, ...landArgs(wave, a));
  assert.equal(r.code, 2);
  assert.equal(r.json.stop, "blocking-findings");
  assert.equal(g(a.worktree, "rev-parse", "HEAD"), head);

  fs.writeFileSync(path.join(a.worktree, "blueprint/context/findings.md"), `${header}${finding("F-01", "P0", "closed", "Danger")}\n`);
  const r2 = land(root, ...landArgs(wave, a, ["--lens-required"]));
  assert.equal(r2.json.stop, "receipt-missing");
  fs.writeFileSync(path.join(a.worktree, "blueprint/context/review.md"), "# Independent Review\n\n**Status:** passed\n**Target commit:** 0000000000000000000000000000000000000000\n");
  const r3 = land(root, ...landArgs(wave, a));
  assert.equal(r3.json.stop, "receipt-stale");
  assert.ok(!fs.existsSync(path.join(a.worktree, "blueprint/history/features/01-alpha-thing.md")));
});

test("a product conflict or a failed integration Verify restores both branches", (t) => {
  const { root, wave } = startWave(t);
  const a = item(wave, "1");
  const b = item(wave, "2");
  build(a.worktree, { id: "1", title: "Alpha thing", branch: a.branch, file: "shared.txt", content: "alpha owns this\n" });
  build(b.worktree, { id: "2", title: "Beta thing", branch: b.branch, file: "shared.txt", content: "beta owns this\n" });
  av(root, "checkpoint", "--id", "1");
  av(root, "checkpoint", "--id", "2");
  assert.equal(land(root, ...landArgs(wave, a)).code, 0);

  const headB = g(b.worktree, "rev-parse", "HEAD");
  const tip = g(wave.integrationWorktree, "rev-parse", "HEAD");
  const specB = fs.readFileSync(path.join(b.worktree, "blueprint/context/current-feature.md"), "utf8");
  const r = land(root, ...landArgs(wave, b));
  assert.equal(r.code, 2, r.stdout);
  assert.equal(r.json.stop, "conflict");
  assert.deepEqual(r.json.files, ["shared.txt"]);
  assert.equal(g(b.worktree, "rev-parse", "HEAD"), headB);
  assert.equal(g(wave.integrationWorktree, "rev-parse", "HEAD"), tip);
  assert.equal(fs.readFileSync(path.join(b.worktree, "blueprint/context/current-feature.md"), "utf8"), specB);
  assert.ok(!fs.existsSync(path.join(b.worktree, "blueprint/history/features/02-beta-thing.md")));
  assert.equal(g(wave.integrationWorktree, "status", "--porcelain"), "");

  // The merger's path: merge the wave into the feature, resolve, bookkeeping by script.
  spawnSync("git", ["merge", "--no-edit", "wave/1"], { cwd: b.worktree });
  fs.writeFileSync(path.join(b.worktree, "shared.txt"), "alpha owns this\nbeta owns this\n");
  g(b.worktree, "add", "shared.txt");
  const res = land(b.worktree, "resolve", "--worktree", b.worktree);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.deepEqual(res.json.remaining, []);
});

test("an integration-only Verify failure resets the squash", (t) => {
  const { root, wave } = startWave(t);
  const a = item(wave, "1");
  const b = item(wave, "2");
  build(a.worktree, { id: "1", title: "Alpha thing", branch: a.branch, file: "a.txt", content: "BOOM\n" });
  build(b.worktree, { id: "2", title: "Beta thing", branch: b.branch, file: "b.txt", content: "BOOM\n" });
  av(root, "checkpoint", "--id", "1");
  av(root, "checkpoint", "--id", "2");
  assert.equal(land(root, ...landArgs(wave, a)).code, 0);
  const tip = g(wave.integrationWorktree, "rev-parse", "HEAD");
  const headB = g(b.worktree, "rev-parse", "HEAD");
  const r = land(root, ...landArgs(wave, b));
  assert.equal(r.json.stop, "verify-failed-integration");
  assert.match(r.json.verify.tail, /combined BOOM/);
  assert.equal(g(wave.integrationWorktree, "rev-parse", "HEAD"), tip);
  assert.equal(g(b.worktree, "rev-parse", "HEAD"), headB);
  assert.match(fs.readFileSync(path.join(b.worktree, "blueprint/context/current-feature.md"), "utf8"), /# Feature: Beta thing/);
});

test("close refuses until the wave is in the default branch", (t) => {
  const { root, wave } = startWave(t, "1");
  const a = item(wave, "1");
  build(a.worktree, { id: "1", title: "Alpha thing", branch: a.branch, file: "a.txt", content: "alpha\n" });
  av(root, "checkpoint", "--id", "1");
  assert.equal(land(root, ...landArgs(wave, a)).code, 0);
  assert.equal(av(root, "close").json.stop, "not-landed");
  g(root, "merge", "-q", "--ff-only", "wave/1");
  const c = av(root, "close").json;
  assert.equal(c.deletedBranch, "wave/1");
  assert.ok(!fs.existsSync(wave.integrationWorktree));
  assert.ok(!fs.existsSync(path.join(root, "blueprint/.state/avengers.json")));
});

test("insert-only conflicts are unioned; the squash keeps both additions", (t) => {
  const { root, wave } = startWave(t);
  const a = item(wave, "1");
  const b = item(wave, "2");
  build(a.worktree, { id: "1", title: "Alpha thing", branch: a.branch, file: "shared.txt", content: "line one\nline two\nexport alpha\n" });
  build(b.worktree, { id: "2", title: "Beta thing", branch: b.branch, file: "shared.txt", content: "line one\nline two\nexport beta\n" });
  av(root, "checkpoint", "--id", "1");
  av(root, "checkpoint", "--id", "2");
  assert.equal(land(root, ...landArgs(wave, a)).code, 0);
  const r = land(root, ...landArgs(wave, b));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(r.json.bookkeeping.includes("additive union: shared.txt"));
  assert.equal(fs.readFileSync(path.join(wave.integrationWorktree, "shared.txt"), "utf8"), "line one\nline two\nexport alpha\nexport beta\n");
});

function setPlan(root, plan) {
  fs.writeFileSync(path.join(root, "blueprint/build-plan.md"), plan);
  const hash = overviewHash(fs.readFileSync(path.join(root, "blueprint/project-plan.md")), Buffer.from(plan));
  fs.writeFileSync(path.join(root, "blueprint/context/project-overview.md"), `# Test - Project Overview\n\n<!-- blueprint:source-hash ${hash} -->\n\nBody.\n`);
  g(root, "commit", "-qam", "docs: plan");
}

test("payments and SMS items are flagged sensitive and never share a wave", (t) => {
  const { root } = project(t);
  setPlan(root, `# Build Plan

- [ ] 1. **Checkout** - pay with PesaPal _(after: none)_
- [ ] 2. **Seller payouts** - Flutterwave escrow release _(after: none)_
- [ ] 3. **Order texts** - Africa's Talking SMS and its delivery webhook _(after: none)_
- [ ] 4. **About page** - static copy _(after: none)_
`);
  const pre = av(root, "preflight").json;
  assert.deepEqual(pre.frontier.map((f) => [f.id, f.sensitive]), [
    ["1", ["payments"]],
    ["2", ["payments"]],
    ["3", ["sms", "webhooks"]],
    ["4", []]
  ]);
  const setup = av(root, "setup", "--items", "1,2,3").json;
  assert.deepEqual(setup.items.map((i) => i.id), ["1", "3"]);
  assert.deepEqual(setup.deferred, [{ id: "2", reason: "serialized after item 1 (payments)" }]);
});

test("checkpoint and classify catch sensitive work the plan line did not name", (t) => {
  const { root } = project(t);
  const wave = av(root, "setup", "--items", "1,2").json;
  const a = item(wave, "1");
  const b = item(wave, "2");
  assert.deepEqual(a.sensitive, []);
  build(a.worktree, { id: "1", title: "Alpha thing", branch: a.branch, file: "a.txt", content: "import AfricasTalking from 'africastalking';\n" });
  build(b.worktree, { id: "2", title: "Beta thing", branch: b.branch, file: "b.txt", content: "sendSms(to)\n// africa's talking callback\n" });
  const cp = av(root, "checkpoint", "--id", "1").json;
  assert.deepEqual(Object.keys(cp.sensitive), ["sms"]);
  const c = av(root, "classify", "--id", "2").json;
  assert.deepEqual(c.categories, ["sms"]);
  assert.deepEqual(c.serializeAfter, { with: "1", categories: ["sms"] });
});
