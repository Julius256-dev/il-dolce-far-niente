import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decide, dominantEol, isBinary, run, transformMatt, type MergeFn } from "./sync-upstream.js";

const renames = {
  "code-review": "mp-code-review",
  tdd: "mp-tdd",
  research: "mp-research",
  grilling: "mp-grilling",
  "domain-modeling": "mp-domain-modeling",
  "setup-matt-pocock-skills": "onboard",
  "to-tickets": "plan-graph"
};

test("renames the frontmatter name", () => {
  const out = transformMatt("---\nname: to-tickets\ndescription: x\n---\n", renames);
  assert.match(out, /^name: plan-graph$/m);
});

test("renames skills called through the Skill tool", () => {
  const out = transformMatt('Call the Skill tool twice, for "grilling" and "domain-modeling".\nCall the Skill tool with `tdd`.', renames);
  assert.equal(out, 'Call the Skill tool twice, for "mp-grilling" and "mp-domain-modeling".\nCall the Skill tool with `mp-tdd`.');
});

test("renames slash commands and named skills", () => {
  assert.equal(transformMatt("tell the user to run `/setup-matt-pocock-skills`.", renames), "tell the user to run `/onboard`.");
  assert.equal(transformMatt("see the `code-review` skill", renames), "see the `mp-code-review` skill");
});

test("leaves prose, labels and paths alone", () => {
  const text = "Do the research first. Labels: `research`, `grilling`. See docs/research/notes.md and wayfinder:research.";
  assert.equal(transformMatt(text, renames), text);
});

// ---------------------------------------------------------------------------
// decide(): one test per outcome
// ---------------------------------------------------------------------------

const b = (s: string): Buffer => Buffer.from(s, "utf8");
const text = (buf: Buffer | undefined): string | undefined => buf?.toString("utf8");
const noMerge: MergeFn = () => {
  throw new Error("merge must not be called");
};

const BASE = "one\ntwo\nthree\nfour\nfive\n";

test("decide: added when only upstream has the file", () => {
  const d = decide({ ours: null, base: null, theirs: b("new\n"), binary: false, merge: noMerge });
  assert.equal(d.outcome, "added");
  assert.equal(text(d.target), "new\n");
  assert.equal(text(d.base), "new\n");
});

test("decide: updated when ours is untouched and upstream changed", () => {
  const d = decide({ ours: b(BASE), base: b(BASE), theirs: b(BASE + "six\n"), binary: false, merge: noMerge });
  assert.equal(d.outcome, "updated");
  assert.equal(text(d.target), BASE + "six\n");
  assert.equal(text(d.base), BASE + "six\n");
});

test("decide: merged when both sides changed different lines", () => {
  const ours = b("ONE\ntwo\nthree\nfour\nfive\n");
  const theirs = b("one\ntwo\nthree\nfour\nFIVE\n");
  const d = decide({ ours, base: b(BASE), theirs, binary: false });
  assert.equal(d.outcome, "merged");
  assert.equal(text(d.target), "ONE\ntwo\nthree\nfour\nFIVE\n");
  assert.equal(text(d.base), text(theirs));
});

test("decide: conflict when both sides changed the same line", () => {
  const d = decide({ ours: b(BASE.replace("three", "ours")), base: b(BASE), theirs: b(BASE.replace("three", "theirs")), binary: false });
  assert.equal(d.outcome, "conflict");
  assert.match(text(d.target) ?? "", /<<<<<<< ours[\s\S]*=======[\s\S]*>>>>>>> upstream/);
  assert.ok(d.base);
});

test("decide: kept-ours when only ours changed", () => {
  const d = decide({ ours: b(BASE + "ext\n"), base: b(BASE), theirs: b(BASE), binary: false, merge: noMerge });
  assert.equal(d.outcome, "kept-ours");
  assert.equal(d.target, undefined);
  assert.equal(d.base, undefined);
});

test("decide: unchanged when nothing changed", () => {
  const d = decide({ ours: b(BASE), base: b(BASE), theirs: b(BASE), binary: false, merge: noMerge });
  assert.deepEqual(d, { outcome: "unchanged" });
});

test("decide: removed when upstream deleted and ours is untouched", () => {
  const d = decide({ ours: b(BASE), base: b(BASE), theirs: null, binary: false, merge: noMerge });
  assert.equal(d.outcome, "removed");
  assert.ok(d.removeTarget && d.removeBase);
});

test("decide: removed-upstream-kept-ours when upstream deleted an edited file", () => {
  const d = decide({ ours: b(BASE + "ext\n"), base: b(BASE), theirs: null, binary: false, merge: noMerge });
  assert.equal(d.outcome, "removed-upstream-kept-ours");
  assert.ok(!d.removeTarget && d.removeBase);
});

test("decide: skipped-deleted-locally tracks the new base only", () => {
  const d = decide({ ours: null, base: b(BASE), theirs: b(BASE + "six\n"), binary: false, merge: noMerge });
  assert.equal(d.outcome, "skipped-deleted-locally");
  assert.equal(d.target, undefined);
  assert.equal(text(d.base), BASE + "six\n");
});

test("decide: no base and ours equals theirs records the base as unchanged", () => {
  const d = decide({ ours: b(BASE), base: null, theirs: b(BASE), binary: false, merge: noMerge });
  assert.equal(d.outcome, "unchanged");
  assert.equal(d.target, undefined);
  assert.equal(text(d.base), BASE);
});

test("decide: no base and ours differs is needs-baseline and writes nothing", () => {
  const d = decide({ ours: b(BASE + "ext\n"), base: null, theirs: b("upstream moved on\n"), binary: false, merge: noMerge });
  assert.deepEqual(d, { outcome: "needs-baseline" });
});

test("decide: no base for a binary file differing from upstream is needs-baseline", () => {
  const d = decide({ ours: Buffer.from([0, 1, 2]), base: null, theirs: Buffer.from([0, 1, 3]), binary: true, merge: noMerge });
  assert.deepEqual(d, { outcome: "needs-baseline" });
});

// ---------------------------------------------------------------------------
// Binary files
// ---------------------------------------------------------------------------

test("isBinary: NUL bytes or invalid UTF-8 mean binary", () => {
  assert.equal(isBinary(b("plain text\n")), false);
  assert.equal(isBinary(b("héllo ✓\n")), false);
  assert.equal(isBinary(Buffer.from([0x61, 0x00, 0x62])), true);
  assert.equal(isBinary(Buffer.from([0xff, 0xfe, 0x41])), true);
});

test("decide: binary copies theirs byte for byte when ours is untouched", () => {
  const base = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00]);
  const theirs = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x00, 0xff]);
  const d = decide({ ours: Buffer.from(base), base, theirs, binary: true, merge: noMerge });
  assert.equal(d.outcome, "updated");
  assert.ok(d.target?.equals(theirs));
  assert.ok(d.base?.equals(theirs));
});

test("decide: binary keeps ours when upstream is unchanged", () => {
  const base = Buffer.from([0, 1, 2, 0x0d, 0x0a]);
  const d = decide({ ours: Buffer.from([0, 9, 9]), base, theirs: Buffer.from(base), binary: true, merge: noMerge });
  assert.equal(d.outcome, "kept-ours");
  assert.equal(d.target, undefined);
});

test("decide: binary-conflict when both sides changed, nothing written", () => {
  const d = decide({
    ours: Buffer.from([0, 1, 1]),
    base: Buffer.from([0, 1, 2]),
    theirs: Buffer.from([0, 1, 3]),
    binary: true,
    merge: noMerge
  });
  assert.deepEqual(d, { outcome: "binary-conflict" });
});

// ---------------------------------------------------------------------------
// Line endings
// ---------------------------------------------------------------------------

const crlf = (s: string): string => s.replace(/\n/g, "\r\n");

test("dominantEol picks the majority line ending", () => {
  assert.equal(dominantEol(b("a\r\nb\r\nc\n")), "\r\n");
  assert.equal(dominantEol(b("a\nb\r\nc\n")), "\n");
  assert.equal(dominantEol(b("no newline")), null);
});

test("decide: CRLF ours vs LF base/theirs is unchanged, not a conflict", () => {
  const d = decide({ ours: b(crlf(BASE)), base: b(BASE), theirs: b(BASE), binary: false, merge: noMerge });
  assert.equal(d.outcome, "unchanged");
  assert.equal(d.target, undefined);
});

test("decide: upstream update over untouched CRLF ours keeps CRLF", () => {
  const d = decide({ ours: b(crlf(BASE)), base: b(BASE), theirs: b(BASE + "six\n"), binary: false, merge: noMerge });
  assert.equal(d.outcome, "updated");
  assert.equal(text(d.target), crlf(BASE + "six\n"));
  assert.equal(text(d.base), BASE + "six\n", "the base keeps upstream's own bytes");
});

test("decide: CRLF ours with an edit merges cleanly with an LF upstream edit", () => {
  const ours = b(crlf("ONE\ntwo\nthree\nfour\nfive\n"));
  const theirs = b("one\ntwo\nthree\nfour\nFIVE\n");
  const d = decide({ ours, base: b(BASE), theirs, binary: false });
  assert.equal(d.outcome, "merged");
  assert.equal(text(d.target), crlf("ONE\ntwo\nthree\nfour\nFIVE\n"));
});

test("decide: LF ours with CRLF upstream normalises the other way", () => {
  const d = decide({ ours: b(BASE + "ext\n"), base: b(crlf(BASE)), theirs: b(crlf(BASE)), binary: false, merge: noMerge });
  assert.equal(d.outcome, "kept-ours");
});

test("decide: no base, CRLF ours equal to LF theirs records the base", () => {
  const d = decide({ ours: b(crlf(BASE)), base: null, theirs: b(BASE), binary: false, merge: noMerge });
  assert.equal(d.outcome, "unchanged");
  assert.equal(text(d.base), BASE);
});

// ---------------------------------------------------------------------------
// merge-file failures
// ---------------------------------------------------------------------------

for (const status of [255, 128, null, -1]) {
  test(`decide: merge-file status ${status} is an error and writes nothing`, () => {
    const failing: MergeFn = () => ({ status, stdout: Buffer.alloc(0), stderr: "error: Cannot merge binary files" });
    const d = decide({ ours: b(BASE + "ours\n"), base: b(BASE), theirs: b("theirs\n" + BASE), binary: false, merge: failing });
    assert.equal(d.outcome, "error");
    assert.match(d.error ?? "", /Cannot merge binary files/);
    assert.equal(d.target, undefined);
    assert.equal(d.base, undefined);
    assert.ok(!d.removeTarget && !d.removeBase);
  });
}

test("decide: merge-file statuses 1-127 are conflict counts", () => {
  const fake: MergeFn = () => ({ status: 3, stdout: b("markers\n"), stderr: "" });
  const d = decide({ ours: b(BASE + "ours\n"), base: b(BASE), theirs: b("theirs\n" + BASE), binary: false, merge: fake });
  assert.equal(d.outcome, "conflict");
  assert.equal(text(d.target), "markers\n");
});

// ---------------------------------------------------------------------------
// End to end against temp fixture repos
// ---------------------------------------------------------------------------

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "sync-upstream.ts");

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

function put(root: string, rel: string, content: string | Buffer): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

function fixture(t: { after: (fn: () => void) => void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "idfn-sync-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(
    root,
    "upstream.lock.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        sources: {
          x: { repo: "https://example.invalid/x", ref: "main", prefix: "upstream/x", commit: "0000000", license: "MIT", copyright: "test" }
        },
        mappings: [
          { source: "x", from: "skills", to: "skills" },
          { source: "x", from: "matt/tdd", to: "skills/mp-tdd", transform: "matt" }
        ],
        renames: { tdd: "mp-tdd" }
      },
      null,
      2
    ) + "\n"
  );
  const upstreamSkill = "---\nname: tdd\n---\n# Intro\n\nline a\nline b\nline c\n";
  const transformed = "---\nname: mp-tdd\n---\n# Intro\n\nline a\nline b\nline c\n";
  put(root, "upstream/x/matt/tdd/SKILL.md", upstreamSkill);
  put(root, "upstream/x/skills/plain/README.md", "plain\n");
  put(root, ".upstream-base/skills/mp-tdd/SKILL.md", transformed);
  put(root, ".upstream-base/skills/plain/README.md", "plain\n");
  put(root, "skills/mp-tdd/SKILL.md", transformed + "\n<!-- ext:begin -->\nOur extension.\n<!-- ext:end -->\n");
  put(root, "skills/plain/README.md", "plain\n");
  git(root, "init", "-q");
  git(root, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
  git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return root;
}

test("e2e: an upstream edit merges into ours and keeps our ext block", async (t) => {
  const root = fixture(t);
  put(root, "upstream/x/matt/tdd/SKILL.md", "---\nname: tdd\n---\n# Intro\n\nline a\nline B changed upstream, see `/tdd`\nline c\n");

  const { results, exitCode } = await run({ root, checkOnly: false });
  assert.equal(exitCode, 0);
  const byTarget = Object.fromEntries(results.map((r) => [r.target, r.outcome]));
  assert.equal(byTarget["skills/mp-tdd/SKILL.md"], "merged");
  assert.equal(byTarget["skills/plain/README.md"], "unchanged");
  assert.equal(Object.keys(byTarget).length, 2, "each file is owned by exactly one mapping");

  assert.equal(
    read(root, "skills/mp-tdd/SKILL.md"),
    "---\nname: mp-tdd\n---\n# Intro\n\nline a\nline B changed upstream, see `/mp-tdd`\nline c\n\n<!-- ext:begin -->\nOur extension.\n<!-- ext:end -->\n"
  );
  assert.equal(read(root, ".upstream-base/skills/mp-tdd/SKILL.md"), "---\nname: mp-tdd\n---\n# Intro\n\nline a\nline B changed upstream, see `/mp-tdd`\nline c\n");
  assert.ok(!fs.existsSync(path.join(root, "skills/tdd")));
});

test("e2e: --check writes nothing", async (t) => {
  const root = fixture(t);
  put(root, "upstream/x/matt/tdd/SKILL.md", "---\nname: tdd\n---\n# Intro changed\n");
  const before = read(root, "skills/mp-tdd/SKILL.md");
  const lockBefore = read(root, "upstream.lock.json");
  const { results } = await run({ root, checkOnly: true });
  assert.ok(results.length > 0);
  assert.equal(read(root, "skills/mp-tdd/SKILL.md"), before);
  assert.equal(read(root, "upstream.lock.json"), lockBefore);
});

test("e2e CLI: missing base with differing ours exits 2, reports needs-baseline and writes nothing", (t) => {
  const root = fixture(t);
  fs.rmSync(path.join(root, ".upstream-base/skills/mp-tdd/SKILL.md"));
  put(root, "upstream/x/matt/tdd/SKILL.md", "---\nname: tdd\n---\n# Upstream rewrote this\n");
  const ours = read(root, "skills/mp-tdd/SKILL.md");

  const r = spawnSync(process.execPath, ["--import", "tsx", scriptPath, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stdout, /### Set the baseline by hand/);
  assert.match(r.stdout, /- \[ \] `skills\/mp-tdd\/SKILL.md`/);
  assert.equal(read(root, "skills/mp-tdd/SKILL.md"), ours);
  assert.ok(!fs.existsSync(path.join(root, ".upstream-base/skills/mp-tdd/SKILL.md")));
});

test("e2e: binary files are copied byte for byte and binary conflicts exit 2", async (t) => {
  const root = fixture(t);
  const v1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
  const v2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x02, 0xff]);
  for (const name of ["a.png", "b.png"]) {
    put(root, `upstream/x/skills/img/${name}`, v2);
    put(root, `.upstream-base/skills/img/${name}`, v1);
  }
  put(root, "skills/img/a.png", v1); // untouched: takes upstream
  const oursB = Buffer.from([0x00, 0x99]);
  put(root, "skills/img/b.png", oursB); // edited: conflict

  const { results, exitCode, report } = await run({ root, checkOnly: false });
  const byTarget = Object.fromEntries(results.map((r) => [r.target, r.outcome]));
  assert.equal(byTarget["skills/img/a.png"], "updated");
  assert.equal(byTarget["skills/img/b.png"], "binary-conflict");
  assert.equal(exitCode, 2);
  assert.match(report, /### Conflicts to resolve/);
  assert.ok(fs.readFileSync(path.join(root, "skills/img/a.png")).equals(v2));
  assert.ok(fs.readFileSync(path.join(root, "skills/img/b.png")).equals(oursB));
  assert.ok(fs.readFileSync(path.join(root, ".upstream-base/skills/img/b.png")).equals(v1), "base not advanced");
});

test("e2e: CRLF ours with an LF upstream edit merges without a whole-file conflict", async (t) => {
  const root = fixture(t);
  put(root, "skills/plain/README.md", "plain\r\nours\r\n");
  put(root, ".upstream-base/skills/plain/README.md", "plain\n");
  put(root, "upstream/x/skills/plain/README.md", "upstream first\nplain\n");
  const { results } = await run({ root, checkOnly: false });
  assert.equal(results.find((r) => r.target === "skills/plain/README.md")?.outcome, "merged");
  assert.equal(read(root, "skills/plain/README.md"), "upstream first\r\nplain\r\nours\r\n");
});
