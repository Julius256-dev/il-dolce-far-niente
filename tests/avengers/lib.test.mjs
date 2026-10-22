import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  FINDINGS_STUB,
  archiveRelPath,
  computeFrontier,
  findingPrefix,
  normalizeId,
  overviewHash,
  parseLedger,
  parsePlan,
  parseSpec,
  parseVerifyCommand,
  replaceSourceHash,
  setEntryStatus,
  tickPlan,
  unionLedgers,
  unionPlanTicks
} from "../../skills/avengers/scripts/lib.mjs";
import { finding, spec } from "./fixture.mjs";

const PLAN = `# Build Plan

- [ ] 1. **One** - a _(after: none)_
- [x] 2. **Two** - b
- [ ] 3. **Three** - parent
  - [ ] 3a. **Three A** - _(after: 1)_
  - [ ] 3b. **Three B** - _(after: 2)_
- [ ] 4. **Four** - serial
- [ ] 5. **Five** - _(after: 3)_
`;

test("IDs normalize and archive paths follow build-history", () => {
  assert.equal(normalizeId("012A"), "12a");
  assert.equal(normalizeId("feature"), null);
  assert.equal(archiveRelPath("2", "ugx-price", 1), "blueprint/history/features/02-ugx-price.md");
  assert.equal(archiveRelPath("12a", "export", 3), "blueprint/history/features/12a-export--build-3.md");
  assert.equal(findingPrefix("12", 1), "12");
  assert.equal(findingPrefix("12", 2), "12-build-2");
});

test("plan parsing finds parents and edges", () => {
  const { items } = parsePlan(PLAN);
  const three = items.find((i) => i.id === "3");
  assert.deepEqual(three.children, ["3a", "3b"]);
  assert.deepEqual(items.find((i) => i.id === "1").after, []);
  assert.equal(items.find((i) => i.id === "4").after, null);
  assert.deepEqual(items.find((i) => i.id === "3b").after, ["2"]);
});

test("frontier applies explicit edges, serial leaves and parent dependencies", () => {
  const { frontier, blocked } = computeFrontier(PLAN);
  assert.deepEqual(frontier.map((f) => f.id), ["1", "3b"]);
  assert.deepEqual(blocked.find((b) => b.id === "4").waitingOn, ["1", "3a", "3b"]);
  assert.deepEqual(blocked.find((b) => b.id === "5").waitingOn, ["3"]);
  assert.deepEqual(computeFrontier(PLAN, { exclude: ["1"] }).frontier.map((f) => f.id), ["3b"]);
});

test("ticking the last sub-item ticks its parent", () => {
  const once = tickPlan(PLAN, "3a");
  assert.match(once, /- \[ \] 3\. \*\*Three\*\*/);
  const twice = tickPlan(once, "3b");
  assert.match(twice, /- \[x\] 3\. \*\*Three\*\*/);
  assert.throws(() => tickPlan(PLAN, "9"), /not found/);
  assert.throws(() => tickPlan(PLAN, "3"), /sub-items/);
});

test("tick union keeps ticks from both sides and promotes parents", () => {
  const a = tickPlan(PLAN, "3a");
  const b = tickPlan(PLAN, "3b");
  const merged = unionPlanTicks(a, b);
  assert.match(merged, /- \[x\] 3a\./);
  assert.match(merged, /- \[x\] 3b\./);
  assert.match(merged, /- \[x\] 3\. /);
  assert.equal(unionPlanTicks(a, b.replace("Four", "Fore")), null);
});

test("overview hash matches the /overview contract", () => {
  const project = Buffer.from("# P\n");
  const expected = createHash("sha256")
    .update(Buffer.concat([project, Buffer.from([0]), Buffer.from(PLAN.replace("- [x] 2.", "- [ ] 2."))]))
    .digest("hex");
  assert.equal(overviewHash(project, Buffer.from(PLAN)), expected);
  const overview = `# O\n\n<!-- blueprint:source-hash ${"0".repeat(64)} -->\n`;
  assert.match(replaceSourceHash(overview, expected), new RegExp(expected));
  assert.equal(replaceSourceHash("# no marker\n", expected), null);
});

test("spec parsing reads identity, status and steps", () => {
  const s = parseSpec(spec({ id: "07", title: "Thing", branch: "feature/thing", steps: 3, checked: false }));
  assert.equal(s.id, "7");
  assert.equal(s.attempt, 1);
  assert.equal(s.status, "in progress");
  assert.equal(s.steps, 3);
  assert.equal(s.stepsChecked, 0);
  assert.equal(s.branch, "feature/thing");
});

test("Verify is read from the Commands section", () => {
  assert.equal(parseVerifyCommand("## Commands\n\n- Verify: `npm run verify` (all)\n"), "npm run verify");
  assert.equal(parseVerifyCommand("- Build: `npm run build`\n"), null);
});

test("ledger parsing and status updates keep the header contract", () => {
  const text = `${FINDINGS_STUB.split("_No findings")[0]}${finding("F-01", "P1", "fixed", "Bad")}\n\n${finding("F-02", "P3", "open", "Meh")}\n`;
  const { entries } = parseLedger(text);
  assert.deepEqual(entries.map((e) => [e.id, e.severity, e.status, e.axis]), [["F-01", "P1", "fixed", "standards"], ["F-02", "P3", "open", "standards"]]);
  const closed = setEntryStatus(entries[0], "closed", "verified at abc");
  assert.match(closed.body, /^### F-01 \[P1\] closed - Bad/);
  assert.match(closed.body, /\*\*Resolution:\*\* verified at abc/);
});

test("ledger union drops archived entries and renumbers clashing new ones", () => {
  const header = FINDINGS_STUB.split("_No findings")[0];
  const base = `${header}${finding("F-01", "P2", "open", "Carried")}\n`;
  const ours = `${header}${finding("F-01", "P2", "open", "Carried")}\n\n${finding("F-02", "P3", "open", "From item A")}\n`;
  const theirs = `${header}${finding("F-02", "P2", "open", "From item B")}\n`;
  const r = unionLedgers(base, ours, theirs, { branch: "feature/b" });
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.renumbered, [{ from: "F-02", to: "F-03" }]);
  const ids = parseLedger(r.text).entries.map((e) => `${e.id} ${e.title}`);
  assert.deepEqual(ids, ["F-02 From item A", "F-03 From item B"]);
  assert.match(r.text, /landed from `feature\/b` as F-02/);
  const both = unionLedgers(FINDINGS_STUB, FINDINGS_STUB, FINDINGS_STUB, { branch: "x" });
  assert.equal(both.text, FINDINGS_STUB);
});
