import assert from "node:assert/strict";
import test from "node:test";
import { transformMatt } from "./sync-upstream.js";

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
