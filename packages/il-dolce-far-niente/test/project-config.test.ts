import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  PROJECT_CONFIG_PATH,
  createDefaultProjectConfig,
  parseProjectConfig,
  readProjectConfig
} from "../lib/project-config.js";

test("default config reviews sensitive work and guides testable work automatically", () => {
  const defaults = createDefaultProjectConfig();
  const defaultGates = {
    audit: "manual",
    independentReview: "when-sensitive",
    check: "manual",
    tryGuide: "when-testable"
  };

  assert.deepEqual(defaults.qualityGates.regular, defaultGates);
  assert.deepEqual(defaults.qualityGates.continuous, defaultGates);
  assert.equal(defaults.workflow.stepReview, "feature");
  assert.equal(defaults.workflow.checkpointCommits, "disabled");
  assert.equal(defaults.git.landing, "local-merge");
  assert.equal(defaults.review.independentExecution, "automatic");
  assert.equal(defaults.continuous.finalIntegrationAudit, false);
});

test("manual independent review policy and execution remain valid overrides", () => {
  const config = parseProjectConfig({
    schemaVersion: 1,
    review: { independentExecution: "manual" },
    qualityGates: {
      regular: { independentReview: "manual" },
      continuous: { independentReview: "manual" }
    }
  });

  assert.equal(config.review.independentExecution, "manual");
  assert.equal(config.qualityGates.regular.independentReview, "manual");
  assert.equal(config.qualityGates.continuous.independentReview, "manual");
});

test("readProjectConfig returns defaults when config is missing", async (t) => {
  const projectRoot = await createProject(t);

  assert.deepEqual(await readProjectConfig(projectRoot), {
    path: PROJECT_CONFIG_PATH,
    state: "defaults",
    values: createDefaultProjectConfig(),
    warnings: []
  });
});

test("readProjectConfig merges partial project values over defaults", async (t) => {
  const projectRoot = await createProject(t);
  await writeConfig(projectRoot, {
    schemaVersion: 1,
    git: {
      landing: "pull-request",
      featureBranchPrefix: "feat/"
    },
    qualityGates: {
      regular: {
        audit: "when-sensitive",
        independentReview: "always",
        check: "always"
      },
      continuous: {
        tryGuide: "when-user-facing"
      }
    },
    review: {
      independentExecution: "automatic"
    },
    continuous: {
      maxFeatures: 4
    }
  });

  const result = await readProjectConfig(projectRoot);

  assert.equal(result.state, "project");
  assert.equal(result.values.git.featureBranchPrefix, "feat/");
  assert.equal(result.values.git.fixBranchPrefix, "fix/");
  assert.equal(result.values.git.landing, "pull-request");
  assert.equal(result.values.review.independentExecution, "automatic");
  assert.equal(result.values.qualityGates.regular.audit, "when-sensitive");
  assert.equal(result.values.qualityGates.regular.independentReview, "always");
  assert.equal(result.values.qualityGates.regular.check, "always");
  assert.equal(result.values.qualityGates.regular.tryGuide, "when-testable");
  assert.equal(
    result.values.qualityGates.continuous.tryGuide,
    "when-user-facing"
  );
  assert.equal(
    result.values.qualityGates.continuous.independentReview,
    "when-sensitive"
  );
  assert.equal(result.values.continuous.maxFeatures, 4);
  assert.equal(result.values.continuous.maxRepairAttempts, 2);
  assert.deepEqual(result.warnings, []);
});

test("readProjectConfig reports malformed JSON and falls back safely", async (t) => {
  const projectRoot = await createProject(t);
  const configPath = path.join(projectRoot, PROJECT_CONFIG_PATH);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, "not json\n");

  const result = await readProjectConfig(projectRoot);

  assert.equal(result.state, "invalid");
  assert.deepEqual(result.values, createDefaultProjectConfig());
  assert.deepEqual(result.warnings, [
    {
      code: "invalid_config",
      message: "Invalid Blueprint config JSON: blueprint/config.json"
    }
  ]);
});

test("try guide policies preserve existing values and accept when-testable", () => {
  for (const tryGuide of [
    "manual",
    "always",
    "when-user-facing",
    "when-testable"
  ] as const) {
    const config = parseProjectConfig({
      schemaVersion: 1,
      qualityGates: { regular: { tryGuide } }
    });

    assert.equal(config.qualityGates.regular.tryGuide, tryGuide);
  }
});

test("readProjectConfig rejects unknown and invalid values", async (t) => {
  const projectRoot = await createProject(t);
  await writeConfig(projectRoot, {
    schemaVersion: 1,
    qualityGates: {
      regular: {
        audit: "sometimes"
      }
    }
  });

  const result = await readProjectConfig(projectRoot);

  assert.equal(result.state, "invalid");
  assert.match(
    result.warnings[0]?.message || "",
    /qualityGates\.regular\.audit must be one of/
  );
  assert.deepEqual(result.values, createDefaultProjectConfig());

  assert.throws(
    () => parseProjectConfig({ schemaVersion: 1, extra: true }),
    /config contains unknown key: extra/
  );
  assert.throws(
    () => parseProjectConfig({
      schemaVersion: 1,
      workflow: { manualTry: "every" }
    }),
    /workflow contains unknown key: manualTry/
  );
  assert.throws(
    () => parseProjectConfig({
      schemaVersion: 1,
      qualityGates: {
        continuous: { check: "when-sensitive" }
      }
    }),
    /qualityGates\.continuous\.check must be one of/
  );
  assert.throws(
    () => parseProjectConfig({
      schemaVersion: 1,
      qualityGates: {
        regular: { tryGuide: "when-observable" }
      }
    }),
    /qualityGates\.regular\.tryGuide must be one of/
  );
  assert.throws(
    () => parseProjectConfig({
      schemaVersion: 1,
      qualityGates: {
        regular: { independentReview: "sometimes" }
      }
    }),
    /qualityGates\.regular\.independentReview must be one of/
  );
  assert.throws(
    () => parseProjectConfig({
      schemaVersion: 1,
      qualityGates: {
        regular: { independentReview: "off" }
      }
    }),
    /qualityGates\.regular\.independentReview must be one of/
  );
  assert.throws(
    () => parseProjectConfig({
      schemaVersion: 1,
      review: { independentExecution: "background" }
    }),
    /review\.independentExecution must be one of/
  );
  assert.throws(
    () => parseProjectConfig({
      schemaVersion: 1,
      git: { landing: "direct-push" }
    }),
    /git\.landing must be one of/
  );
});

test("Il Dolce Far Niente keys default to the documented values", () => {
  const defaults = createDefaultProjectConfig();

  assert.equal(defaults.profile, "custom");
  assert.deepEqual(defaults.tracker, {
    kind: "local",
    doc: "blueprint/context/tracker.md",
    labels: {
      bug: "bug",
      enhancement: "enhancement",
      "needs-triage": "needs-triage",
      "needs-info": "needs-info",
      "ready-for-agent": "ready-for-agent",
      "ready-for-human": "ready-for-human",
      wontfix: "wontfix"
    }
  });
  assert.deepEqual(defaults.domainDocs, { glossary: "GLOSSARY.md", adr: "docs/adr" });
  assert.deepEqual(defaults.avengers, {
    maxConcurrent: 3,
    specApproval: "batch",
    integrationBranchPrefix: "wave/",
    worktreeRoot: "../.worktrees",
    serializeWhen: ["shared-files", "migration", "auth", "payments", "config"],
    finalIntegrationAudit: true,
    portBase: 4100
  });
  assert.deepEqual(defaults.models, {
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
  });

  const parsed = parseProjectConfig({ schemaVersion: 1 });
  assert.deepEqual(parsed, defaults);
});

test("Il Dolce Far Niente keys accept every documented value", () => {
  const config = parseProjectConfig({
    schemaVersion: 1,
    profile: "client-delivery",
    tracker: {
      kind: "github",
      doc: "docs/tracker.md",
      labels: { bug: "type: bug", "ready-for-agent": "agent-ready" }
    },
    domainDocs: { glossary: "docs/GLOSSARY.md", adr: "docs/decisions" },
    avengers: {
      maxConcurrent: 1,
      specApproval: "each",
      integrationBranchPrefix: "integration/",
      worktreeRoot: "../trees",
      serializeWhen: ["sensitive", "auth"],
      finalIntegrationAudit: false,
      portBase: 5000
    },
    models: {
      main: "opus[1m]",
      subagentDefault: "inherit",
      roles: { implementer: "haiku", explorer: "claude-haiku-4-5", merger: "best" },
      effort: { planner: "xhigh", implementer: "low" },
      reviewerMustDiffer: false
    }
  });

  assert.equal(config.profile, "client-delivery");
  assert.equal(config.tracker.kind, "github");
  assert.equal(config.tracker.doc, "docs/tracker.md");
  assert.equal(config.tracker.labels.bug, "type: bug");
  assert.equal(config.tracker.labels["ready-for-agent"], "agent-ready");
  assert.equal(config.tracker.labels.wontfix, "wontfix");
  assert.deepEqual(config.domainDocs, { glossary: "docs/GLOSSARY.md", adr: "docs/decisions" });
  assert.deepEqual(config.avengers, {
    maxConcurrent: 1,
    specApproval: "each",
    integrationBranchPrefix: "integration/",
    worktreeRoot: "../trees",
    serializeWhen: ["sensitive", "auth"],
    finalIntegrationAudit: false,
    portBase: 5000
  });
  assert.equal(config.models.main, "opus[1m]");
  assert.equal(config.models.subagentDefault, "inherit");
  assert.equal(config.models.roles.implementer, "haiku");
  assert.equal(config.models.roles.explorer, "claude-haiku-4-5");
  assert.equal(config.models.roles.merger, "best");
  assert.equal(config.models.roles.planner, "claude-opus-5-5");
  assert.deepEqual(config.models.effort, {
    planner: "xhigh",
    implementer: "low",
    "reviewer-lens": "medium",
    "reviewer-standards": "medium",
    "reviewer-spec": "medium"
  });
  assert.equal(config.models.reviewerMustDiffer, false);

  for (const profile of ["client-delivery", "product", "restricted", "custom"]) {
    assert.equal(parseProjectConfig({ schemaVersion: 1, profile }).profile, profile);
  }
  for (const kind of ["local", "github", "gitlab"]) {
    assert.equal(parseProjectConfig({ schemaVersion: 1, tracker: { kind } }).tracker.kind, kind);
  }
  for (const maxConcurrent of [1, 8]) {
    assert.equal(
      parseProjectConfig({ schemaVersion: 1, avengers: { maxConcurrent } }).avengers.maxConcurrent,
      maxConcurrent
    );
  }
  assert.deepEqual(
    parseProjectConfig({ schemaVersion: 1, avengers: { serializeWhen: [] } }).avengers.serializeWhen,
    []
  );
  for (const model of [
    "inherit",
    "fable",
    "opus",
    "sonnet",
    "haiku",
    "best",
    "opusplan",
    "sonnet[1m]",
    "fable[1m]",
    "claude-sonnet-5-5",
    "claude-opus-4-1-20250805"
  ]) {
    assert.equal(parseProjectConfig({ schemaVersion: 1, models: { main: model } }).models.main, model);
  }
  for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
    assert.equal(
      parseProjectConfig({ schemaVersion: 1, models: { effort: { merger: effort } } }).models.effort
        .merger,
      effort
    );
  }
});

test("Il Dolce Far Niente keys reject invalid values", () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ profile: "enterprise" }, /profile must be one of/],
    [{ profile: 1 }, /profile must be one of/],
    [{ tracker: "github" }, /tracker must be an object/],
    [{ tracker: { kind: "jira" } }, /tracker\.kind must be one of/],
    [{ tracker: { doc: "" } }, /tracker\.doc must be a project-relative path/],
    [{ tracker: { doc: "/etc/tracker.md" } }, /tracker\.doc must be a project-relative path/],
    [{ tracker: { doc: "../tracker.md" } }, /tracker\.doc must be a project-relative path/],
    [{ tracker: { owner: "me" } }, /tracker contains unknown key: owner/],
    [{ tracker: { labels: [] } }, /tracker\.labels must be an object/],
    [{ tracker: { labels: { feature: "feature" } } }, /tracker\.labels contains unknown key: feature/],
    [{ tracker: { labels: { bug: "" } } }, /tracker\.labels\.bug must be a non-empty string/],
    [{ tracker: { labels: { wontfix: 3 } } }, /tracker\.labels\.wontfix must be a non-empty string/],
    [{ domainDocs: { glossary: 7 } }, /domainDocs\.glossary must be a project-relative path/],
    [{ domainDocs: { adr: "C:\\adr" } }, /domainDocs\.adr must be a project-relative path/],
    [{ domainDocs: { readme: "README.md" } }, /domainDocs contains unknown key: readme/],
    [{ avengers: { maxConcurrent: 0 } }, /avengers\.maxConcurrent must be an integer from 1 through 8/],
    [{ avengers: { maxConcurrent: 9 } }, /avengers\.maxConcurrent must be an integer from 1 through 8/],
    [{ avengers: { maxConcurrent: 2.5 } }, /avengers\.maxConcurrent must be an integer from 1 through 8/],
    [{ avengers: { specApproval: "none" } }, /avengers\.specApproval must be one of: batch, each/],
    [{ avengers: { integrationBranchPrefix: "Wave" } }, /avengers\.integrationBranchPrefix must be a lowercase branch prefix/],
    [{ avengers: { worktreeRoot: "" } }, /avengers\.worktreeRoot must be a non-empty string/],
    [{ avengers: { serializeWhen: "auth" } }, /avengers\.serializeWhen must be a list of unique values/],
    [{ avengers: { serializeWhen: ["database"] } }, /avengers\.serializeWhen must be a list of unique values/],
    [{ avengers: { serializeWhen: ["auth", "auth"] } }, /avengers\.serializeWhen must be a list of unique values/],
    [{ avengers: { finalIntegrationAudit: "yes" } }, /avengers\.finalIntegrationAudit must be true or false/],
    [{ avengers: { portBase: 80 } }, /avengers\.portBase must be an integer from 1024 through 65535/],
    [{ avengers: { parallel: true } }, /avengers contains unknown key: parallel/],
    [{ models: { main: "gpt-5" } }, /models\.main must be inherit, one of the aliases/],
    [{ models: { main: "Claude-Opus" } }, /models\.main must be inherit/],
    [{ models: { main: "opus[2m]" } }, /models\.main must be inherit/],
    [{ models: { main: "inherit[1m]" } }, /models\.main must be inherit/],
    [{ models: { main: "claude-" } }, /models\.main must be inherit/],
    [{ models: { main: "claude_opus" } }, /models\.main must be inherit/],
    [{ models: { subagentDefault: null } }, /models\.subagentDefault must be inherit/],
    [{ models: { roles: { designer: "opus" } } }, /models\.roles contains unknown key: designer/],
    [{ models: { roles: { planner: "gpt-5" } } }, /models\.roles\.planner must be inherit/],
    [{ models: { effort: { planner: "extreme" } } }, /models\.effort\.planner must be one of: low, medium, high, xhigh, max/],
    [{ models: { effort: { designer: "low" } } }, /models\.effort contains unknown key: designer/],
    [{ models: { reviewerMustDiffer: "true" } }, /models\.reviewerMustDiffer must be true or false/],
    [{ models: { fallback: "opus" } }, /models contains unknown key: fallback/]
  ];

  for (const [extra, expected] of cases) {
    assert.throws(
      () => parseProjectConfig({ schemaVersion: 1, ...extra }),
      expected,
      JSON.stringify(extra)
    );
  }
});

test("readProjectConfig falls back to defaults when a new key is invalid", async (t) => {
  const projectRoot = await createProject(t);
  await writeConfig(projectRoot, { schemaVersion: 1, avengers: { maxConcurrent: 20 } });

  const result = await readProjectConfig(projectRoot);

  assert.equal(result.state, "invalid");
  assert.match(result.warnings[0]?.message || "", /avengers\.maxConcurrent/);
  assert.deepEqual(result.values, createDefaultProjectConfig());
});

test("readProjectConfig refuses symbolic links", async (t) => {
  const projectRoot = await createProject(t);
  const outsidePath = path.join(path.dirname(projectRoot), "outside.json");
  const configPath = path.join(projectRoot, PROJECT_CONFIG_PATH);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(outsidePath, `${JSON.stringify(createDefaultProjectConfig())}\n`);
  await fs.symlink(outsidePath, configPath);

  const result = await readProjectConfig(projectRoot);

  assert.equal(result.state, "invalid");
  assert.match(result.warnings[0]?.message || "", /symbolic link/);
});

async function createProject(t: TestContext): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-config-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

async function writeConfig(projectRoot: string, value: unknown): Promise<void> {
  const configPath = path.join(projectRoot, PROJECT_CONFIG_PATH);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`);
}
