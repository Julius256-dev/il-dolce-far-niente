import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills/models/scripts/resolve.mjs"
);

function project(t, { team, local, agents = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "models-resolve-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "blueprint"));
  fs.mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
  if (team !== undefined) {
    const value = typeof team === "string" ? team : JSON.stringify({ schemaVersion: 1, ...team });
    fs.writeFileSync(path.join(root, "blueprint", "config.json"), value);
  }
  if (local !== undefined) {
    fs.writeFileSync(path.join(root, "blueprint", "config.local.json"), JSON.stringify(local));
  }
  for (const [role, frontmatter] of Object.entries(agents)) {
    fs.writeFileSync(
      path.join(root, ".claude", "agents", `${role}.md`),
      `---\nname: ${role}\n${frontmatter}\ntools: Read\n---\n\n# ${role}\n`
    );
  }
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

function resolve(root, ...args) {
  const result = run(root, ...args);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const FULL_TEAM = {
  models: {
    main: "claude-opus-5-5",
    subagentDefault: "claude-sonnet-5-5",
    roles: {
      planner: "claude-opus-5-5",
      "reviewer-lens": "claude-opus-5-5",
      "reviewer-standards": "claude-opus-5-5",
      "reviewer-spec": "claude-opus-5-5",
      implementer: "claude-sonnet-5-5",
      merger: "claude-sonnet-5-5",
      explorer: "claude-sonnet-5-5"
    },
    effort: {
      planner: "medium",
      "reviewer-lens": "medium",
      "reviewer-standards": "medium",
      "reviewer-spec": "medium"
    },
    reviewerMustDiffer: true
  }
};

test("the shipped team config resolves every role from the team file", (t) => {
  const result = resolve(project(t, { team: FULL_TEAM }));
  assert.deepEqual(result.main, { model: "claude-opus-5-5", family: "opus", source: "team" });
  assert.deepEqual(result.roles.planner, {
    model: "claude-opus-5-5",
    family: "opus",
    effort: "medium",
    source: "team",
    effortSource: "team"
  });
  assert.deepEqual(result.roles.implementer, {
    model: "claude-sonnet-5-5",
    family: "sonnet",
    effort: null,
    source: "team",
    effortSource: "none"
  });
  assert.deepEqual(result.warnings, []);
});

test("each layer wins over every layer below it", (t) => {
  const agents = { implementer: "model: claude-haiku-4-5" };
  const team = { models: { subagentDefault: "claude-sonnet-5-5", roles: { implementer: "claude-opus-5-5" } } };
  const local = { models: { roles: { implementer: "claude-fable-1" } } };

  // inherit only
  assert.equal(resolve(project(t)).roles.implementer.source, "inherit");
  // agent file beats inherit
  let r = resolve(project(t, { agents })).roles.implementer;
  assert.deepEqual([r.model, r.source], ["claude-haiku-4-5", "agent-file"]);
  // subagentDefault beats agent file
  r = resolve(project(t, { agents, team: { models: { subagentDefault: "claude-sonnet-5-5" } } })).roles.implementer;
  assert.deepEqual([r.model, r.source], ["claude-sonnet-5-5", "subagentDefault"]);
  // team role beats subagentDefault
  r = resolve(project(t, { agents, team })).roles.implementer;
  assert.deepEqual([r.model, r.source], ["claude-opus-5-5", "team"]);
  // local role beats team role
  r = resolve(project(t, { agents, team, local })).roles.implementer;
  assert.deepEqual([r.model, r.source], ["claude-fable-1", "local"]);
  // per-run override beats local
  r = resolve(project(t, { agents, team, local }), "--implementer", "claude-haiku-4-5").roles.implementer;
  assert.deepEqual([r.model, r.source], ["claude-haiku-4-5", "override"]);
});

test("subagentDefault applies to unlisted roles and the local file's beats the team's", (t) => {
  const team = { models: { subagentDefault: "claude-sonnet-5-5", roles: { planner: "claude-opus-5-5" } } };
  let result = resolve(project(t, { team }));
  assert.equal(result.roles.planner.source, "team");
  for (const role of ["implementer", "merger", "explorer", "reviewer-spec"]) {
    assert.deepEqual([result.roles[role].model, result.roles[role].source], ["claude-sonnet-5-5", "subagentDefault"]);
  }
  result = resolve(project(t, { team, local: { models: { subagentDefault: "claude-haiku-4-5" } } }));
  assert.equal(result.roles.merger.model, "claude-haiku-4-5");
  assert.equal(result.roles.merger.source, "subagentDefault");
});

test("inherit is the last fallback and has family inherit", (t) => {
  const role = resolve(project(t, { team: { models: { roles: {} } } }), "--role", "explorer").roles.explorer;
  assert.deepEqual(role, { model: "inherit", family: "inherit", effort: null, source: "inherit", effortSource: "none" });
});

test("effort follows the same layers and an empty effort object means no effort", (t) => {
  const agents = { planner: "model: claude-opus-5-5\neffort: low" };
  assert.equal(resolve(project(t, { team: { models: { effort: {} } } })).roles.planner.effort, null);
  assert.equal(resolve(project(t, { agents, team: { models: { effort: {} } } })).roles.planner.effort, "low");
  const team = { models: { effort: { planner: "high" } } };
  assert.equal(resolve(project(t, { agents, team })).roles.planner.effort, "high");
  const local = { models: { effort: { planner: "xhigh" } } };
  assert.equal(resolve(project(t, { agents, team, local })).roles.planner.effort, "xhigh");
  const r = resolve(project(t, { agents, team, local }), "--effort-planner", "max").roles.planner;
  assert.deepEqual([r.effort, r.effortSource], ["max", "override"]);
});

test("group reviewer flags set all three reviewers and role flags beat them", (t) => {
  const root = project(t, { team: FULL_TEAM });
  const result = resolve(root, "--reviewer-spec", "claude-haiku-4-5", "--reviewers", "claude-fable-1", "--effort-reviewers", "high");
  assert.equal(result.roles["reviewer-lens"].model, "claude-fable-1");
  assert.equal(result.roles["reviewer-standards"].model, "claude-fable-1");
  assert.equal(result.roles["reviewer-spec"].model, "claude-haiku-4-5");
  for (const role of ["reviewer-lens", "reviewer-standards", "reviewer-spec"]) {
    assert.equal(result.roles[role].effort, "high");
    assert.equal(result.roles[role].source, "override");
  }
  assert.equal(result.roles.planner.effort, "medium");
  const planner = resolve(root, "--planner", "opus", "--merger", "haiku", "--explorer", "inherit").roles;
  assert.deepEqual([planner.planner.model, planner.merger.model, planner.explorer.model], ["opus", "haiku", "inherit"]);
});

test("family maps full IDs to their family and aliases to themselves", (t) => {
  const root = project(t);
  const cases = {
    "claude-opus-5-5": "opus",
    "claude-sonnet-5-5": "sonnet",
    "claude-haiku-4-5-20251001": "haiku",
    "claude-fable-1": "fable",
    "claude-3-5-sonnet-20241022": "sonnet",
    "claude-unknown-9": null,
    opus: "opus",
    "sonnet[1m]": "sonnet",
    best: "best",
    opusplan: "opusplan",
    inherit: "inherit"
  };
  for (const [model, family] of Object.entries(cases)) {
    assert.equal(resolve(root, "--implementer", model).roles.implementer.family, family, model);
  }
});

test("reviewerMustDiffer warns when a reviewer matches the implementer", (t) => {
  const team = { models: { subagentDefault: "claude-sonnet-5-5", roles: { "reviewer-lens": "claude-opus-5-5" } } };
  const result = resolve(project(t, { team }));
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /reviewer-standards resolves to claude-sonnet-5-5/);
  assert.match(result.warnings[1], /reviewer-spec resolves to claude-sonnet-5-5/);
  const off = resolve(project(t, { team, local: { models: { reviewerMustDiffer: false } } }));
  assert.deepEqual(off.warnings, []);
  // inherit runs on the main model, so it conflicts with an implementer on that model.
  const inherited = resolve(project(t, {
    team: { models: { main: "claude-opus-5-5", roles: { implementer: "claude-opus-5-5", "reviewer-lens": "inherit", "reviewer-standards": "claude-fable-1", "reviewer-spec": "claude-fable-1" } } }
  }));
  assert.equal(inherited.warnings.length, 1);
  assert.match(inherited.warnings[0], /reviewer-lens resolves to claude-opus-5-5/);
});

test("aliases in team config warn, aliases in the local file do not", (t) => {
  const team = { models: { main: "opus", roles: { merger: "sonnet[1m]" }, reviewerMustDiffer: false } };
  const result = resolve(project(t, { team, local: { models: { roles: { planner: "opus" } } } }));
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /models\.main uses the alias "opus"/);
  assert.match(result.warnings[1], /models\.roles\.merger uses the alias "sonnet\[1m\]"/);
});

test("invalid local keys warn and are ignored", (t) => {
  const local = {
    models: { roles: { implementer: "claude-haiku-4-5", designer: "opus" }, fallback: "x" },
    avengers: { maxConcurrent: 2, specApproval: "each" },
    qualityGates: {}
  };
  const result = resolve(project(t, { team: FULL_TEAM, local }));
  assert.equal(result.roles.implementer.model, "claude-haiku-4-5");
  const text = result.warnings.join("\n");
  assert.match(text, /"qualityGates" is not allowed/);
  assert.match(text, /"avengers\.specApproval" is not allowed/);
  assert.match(text, /"models\.fallback" is not a known key/);
  assert.match(text, /"models\.roles\.designer" is not a known key/);
});

test("invalid values exit 1 with a clear message", (t) => {
  const cases = [
    [{ team: { models: { roles: { planner: "gpt-5" } } } }, [], /models\.roles\.planner must be inherit/],
    [{ team: { models: { effort: { planner: "extreme" } } } }, [], /models\.effort\.planner must be one of/],
    [{ team: { models: { roles: { designer: "opus" } } } }, [], /unknown key: designer/],
    [{ local: { models: { main: "Claude-Opus" } } }, [], /models\.main must be inherit/],
    [{ team: "{ not json" }, [], /config\.json is not valid JSON/],
    [{ agents: { merger: "model: gpt-5" } }, [], /merger\.md: model must be inherit/],
    [{}, ["--implementer", "opus[2m]"], /--implementer must be inherit/],
    [{}, ["--effort-reviewers", "huge"], /--effort-reviewers must be one of/],
    [{}, ["--role", "designer"], /--role must be one of/],
    [{}, ["--designer", "opus"], /Unknown option: --designer/],
    [{}, ["--planner"], /--planner needs a value/]
  ];
  for (const [setup, args, pattern] of cases) {
    const result = run(project(t, setup), ...args);
    assert.equal(result.status, 1, JSON.stringify(setup) + args.join(" "));
    assert.match(result.stderr, pattern);
    assert.equal(result.stdout, "");
  }
});

test("--role prints one role and --text prints a table", (t) => {
  const root = project(t, { team: FULL_TEAM });
  const one = resolve(root, "--role", "merger");
  assert.deepEqual(Object.keys(one.roles), ["merger"]);
  const text = run(root, "--text");
  assert.equal(text.status, 0);
  assert.match(text.stdout, /^Role\s+Model\s+Family\s+Effort\s+Comes from/);
  assert.match(text.stdout, /planner\s+claude-opus-5-5\s+opus\s+medium\s+team/);
  assert.match(text.stdout, /implementer\s+claude-sonnet-5-5\s+sonnet\s+-\s+team/);
});
