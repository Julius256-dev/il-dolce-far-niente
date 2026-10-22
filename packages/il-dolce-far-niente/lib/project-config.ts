import fs from "node:fs/promises";
import path from "node:path";

// Stable repo-relative identifier for warnings and status output. path.join
// normalizes the separator for filesystem reads, so this must not be built with
// path.join or Windows would surface "blueprint\config.json" to users.
const PROJECT_CONFIG_PATH = "blueprint/config.json";
const LOCAL_PROJECT_CONFIG_PATH = "blueprint/config.local.json";
const PROJECT_CONFIG_SCHEMA_VERSION = 1 as const;

type StepReviewPolicy = "every" | "feature";
type CheckpointCommitPolicy = "disabled" | "enabled";
type LandingPolicy = "local-merge" | "pull-request";
type LogicTestPolicy = "required" | "when-configured";
type UiEvidencePolicy = "required" | "when-available";
type AuditGatePolicy = "always" | "manual" | "when-sensitive";
type IndependentReviewGatePolicy = "always" | "manual" | "when-sensitive";
type IndependentReviewExecution = "automatic" | "manual";
type CheckGatePolicy = "always" | "manual" | "when-behavioral";
type TryGuideGatePolicy =
  | "always"
  | "manual"
  | "when-testable"
  | "when-user-facing";
type ProjectConfigState = "defaults" | "invalid" | "project";
type ProjectProfile = "client-delivery" | "product" | "restricted" | "custom";
type TrackerKind = "local" | "github" | "gitlab";
type TrackerLabelRole =
  | "bug"
  | "enhancement"
  | "needs-triage"
  | "needs-info"
  | "ready-for-agent"
  | "ready-for-human"
  | "wontfix";
type AvengersSpecApproval = "batch" | "each";
type AvengersSerializeReason =
  | "shared-files"
  | "migration"
  | "auth"
  | "payments"
  | "config"
  | "sms"
  | "sensitive";
type SourceMayLeavePremises = "yes" | "no";
type ModelRole =
  | "planner"
  | "implementer"
  | "merger"
  | "reviewer-lens"
  | "reviewer-standards"
  | "reviewer-spec"
  | "explorer";
type ModelEffort = "low" | "medium" | "high" | "xhigh" | "max";

const PROJECT_PROFILES: readonly ProjectProfile[] = [
  "client-delivery",
  "product",
  "restricted",
  "custom"
];
const TRACKER_KINDS: readonly TrackerKind[] = ["local", "github", "gitlab"];
const TRACKER_LABEL_ROLES: readonly TrackerLabelRole[] = [
  "bug",
  "enhancement",
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix"
];
const AVENGERS_SERIALIZE_REASONS: readonly AvengersSerializeReason[] = [
  "shared-files",
  "migration",
  "auth",
  "payments",
  "config",
  "sms",
  "sensitive"
];
const MODEL_ROLES: readonly ModelRole[] = [
  "planner",
  "implementer",
  "merger",
  "reviewer-lens",
  "reviewer-standards",
  "reviewer-spec",
  "explorer"
];
const MODEL_EFFORTS: readonly ModelEffort[] = ["low", "medium", "high", "xhigh", "max"];
const MODEL_ALIASES: readonly string[] = [
  "fable",
  "opus",
  "sonnet",
  "haiku",
  "best",
  "opusplan"
];

interface QualityGatePolicy {
  audit: AuditGatePolicy;
  independentReview: IndependentReviewGatePolicy;
  check: CheckGatePolicy;
  tryGuide: TryGuideGatePolicy;
}

interface ProjectConfig {
  schemaVersion: typeof PROJECT_CONFIG_SCHEMA_VERSION;
  workflow: {
    stepReview: StepReviewPolicy;
    checkpointCommits: CheckpointCommitPolicy;
  };
  git: {
    landing: LandingPolicy;
    featureBranchPrefix: string;
    fixBranchPrefix: string;
    rollbackBranchPrefix: string;
  };
  verification: {
    logicTests: LogicTestPolicy;
    uiEvidence: UiEvidencePolicy;
  };
  review: {
    independentExecution: IndependentReviewExecution;
  };
  qualityGates: {
    regular: QualityGatePolicy;
    continuous: QualityGatePolicy;
  };
  continuous: {
    maxFeatures: number | null;
    maxRepairAttempts: number;
    finalIntegrationAudit: boolean;
  };
  profile: ProjectProfile;
  tracker: {
    kind: TrackerKind;
    doc: string;
    labels: Record<TrackerLabelRole, string>;
  };
  domainDocs: {
    glossary: string;
    adr: string;
  };
  avengers: {
    maxConcurrent: number;
    specApproval: AvengersSpecApproval;
    integrationBranchPrefix: string;
    worktreeRoot: string;
    serializeWhen: AvengersSerializeReason[];
    finalIntegrationAudit: boolean;
    portBase: number;
  };
  // Categories that always count as sensitive for the `when-sensitive` gates,
  // each with case-insensitive patterns matched against plan lines, specs and diffs.
  sensitive: {
    patterns: Record<string, string[]>;
  };
  research: {
    web: boolean;
  };
  dataHandling: {
    sourceMayLeavePremises: SourceMayLeavePremises | null;
    approvalRecord: string | null;
  };
  models: {
    main: string;
    subagentDefault: string;
    // Only roles the file names. A missing role falls through to the lower
    // layers in skills/models/reference/resolution.md (subagentDefault, the
    // agent file, inherit), so the parser must not invent per-role values.
    roles: Partial<Record<ModelRole, string>>;
    effort: Partial<Record<ModelRole, ModelEffort>>;
    reviewerMustDiffer: boolean;
  };
}

// Personal, Git-ignored overrides (blueprint/config.local.json). Every key is
// optional and only what the file names is returned, so callers can layer it
// over the team config without the parser filling in defaults.
interface LocalProjectConfig {
  models?: {
    main?: string;
    subagentDefault?: string;
    roles?: Partial<Record<ModelRole, string>>;
    effort?: Partial<Record<ModelRole, ModelEffort>>;
    reviewerMustDiffer?: boolean;
  };
  avengers?: {
    maxConcurrent?: number;
  };
}

interface ProjectConfigWarning {
  code: "invalid_config";
  message: string;
}

interface ProjectConfigResult {
  path: typeof PROJECT_CONFIG_PATH;
  state: ProjectConfigState;
  values: ProjectConfig;
  warnings: ProjectConfigWarning[];
}

function createDefaultProjectConfig(): ProjectConfig {
  return {
    schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
    workflow: {
      stepReview: "feature",
      checkpointCommits: "disabled"
    },
    git: {
      landing: "local-merge",
      featureBranchPrefix: "feature/",
      fixBranchPrefix: "fix/",
      rollbackBranchPrefix: "rollback/"
    },
    verification: {
      logicTests: "when-configured",
      uiEvidence: "when-available"
    },
    review: {
      independentExecution: "automatic"
    },
    qualityGates: {
      regular: {
        audit: "manual",
        independentReview: "when-sensitive",
        check: "manual",
        tryGuide: "when-testable"
      },
      continuous: {
        audit: "manual",
        independentReview: "when-sensitive",
        check: "manual",
        tryGuide: "when-testable"
      }
    },
    continuous: {
      maxFeatures: null,
      maxRepairAttempts: 2,
      finalIntegrationAudit: false
    },
    profile: "custom",
    tracker: {
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
    },
    domainDocs: {
      glossary: "GLOSSARY.md",
      adr: "docs/adr"
    },
    avengers: {
      maxConcurrent: 3,
      specApproval: "batch",
      integrationBranchPrefix: "wave/",
      worktreeRoot: "../.worktrees",
      serializeWhen: ["shared-files", "migration", "auth", "payments", "sms", "config"],
      finalIntegrationAudit: true,
      portBase: 4100
    },
    sensitive: {
      patterns: defaultSensitivePatterns()
    },
    research: {
      web: true
    },
    dataHandling: {
      sourceMayLeavePremises: null,
      approvalRecord: null
    },
    models: {
      main: "claude-opus-5-5",
      subagentDefault: "claude-sonnet-5-5",
      roles: {},
      effort: {},
      reviewerMustDiffer: true
    }
  };
}

async function readProjectConfig(projectRoot: string): Promise<ProjectConfigResult> {
  const configPath = path.join(projectRoot, PROJECT_CONFIG_PATH);
  const defaults = createDefaultProjectConfig();

  try {
    const stats = await fs.lstat(configPath);

    if (stats.isSymbolicLink()) {
      return invalidResult("Blueprint config is a symbolic link and was not read.");
    }

    if (!stats.isFile()) {
      return invalidResult("Blueprint config path is not a regular file.");
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        return invalidResult(`Invalid Blueprint config JSON: ${PROJECT_CONFIG_PATH}`);
      }

      throw error;
    }

    try {
      return {
        path: PROJECT_CONFIG_PATH,
        state: "project",
        values: parseProjectConfig(parsed),
        warnings: []
      };
    } catch (error: unknown) {
      return invalidResult(
        `Unsupported or invalid Blueprint config: ${PROJECT_CONFIG_PATH}. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } catch (error: unknown) {
    if (getErrorCode(error) === "ENOENT") {
      return {
        path: PROJECT_CONFIG_PATH,
        state: "defaults",
        values: defaults,
        warnings: []
      };
    }

    return invalidResult(
      `Unable to read Blueprint config: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  function invalidResult(message: string): ProjectConfigResult {
    return {
      path: PROJECT_CONFIG_PATH,
      state: "invalid",
      values: defaults,
      warnings: [{ code: "invalid_config", message }]
    };
  }
}

function parseProjectConfig(value: unknown): ProjectConfig {
  const root = requireRecord(value, "config");
  assertKnownKeys(
    root,
    [
      "schemaVersion",
      "workflow",
      "git",
      "verification",
      "review",
      "qualityGates",
      "continuous",
      "profile",
      "tracker",
      "domainDocs",
      "avengers",
      "sensitive",
      "research",
      "dataHandling",
      "models"
    ],
    "config"
  );

  if (root.schemaVersion !== PROJECT_CONFIG_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${PROJECT_CONFIG_SCHEMA_VERSION}.`);
  }

  const defaults = createDefaultProjectConfig();
  const workflow = optionalRecord(root.workflow, "workflow");
  const git = optionalRecord(root.git, "git");
  const verification = optionalRecord(root.verification, "verification");
  const review = optionalRecord(root.review, "review");
  const qualityGates = optionalRecord(root.qualityGates, "qualityGates");
  const regularGates = optionalRecord(
    qualityGates.regular,
    "qualityGates.regular"
  );
  const continuousGates = optionalRecord(
    qualityGates.continuous,
    "qualityGates.continuous"
  );
  const continuous = optionalRecord(root.continuous, "continuous");
  const tracker = optionalRecord(root.tracker, "tracker");
  const trackerLabels = optionalRecord(tracker.labels, "tracker.labels");
  const domainDocs = optionalRecord(root.domainDocs, "domainDocs");
  const avengers = optionalRecord(root.avengers, "avengers");
  const sensitive = optionalRecord(root.sensitive, "sensitive");
  const research = optionalRecord(root.research, "research");
  const dataHandling = optionalRecord(root.dataHandling, "dataHandling");
  const models = optionalRecord(root.models, "models");
  const modelRoles = optionalRecord(models.roles, "models.roles");
  const modelEffort = optionalRecord(models.effort, "models.effort");

  assertKnownKeys(workflow, ["stepReview", "checkpointCommits"], "workflow");
  assertKnownKeys(
    git,
    [
      "landing",
      "featureBranchPrefix",
      "fixBranchPrefix",
      "rollbackBranchPrefix"
    ],
    "git"
  );
  assertKnownKeys(verification, ["logicTests", "uiEvidence"], "verification");
  assertKnownKeys(review, ["independentExecution"], "review");
  assertKnownKeys(qualityGates, ["regular", "continuous"], "qualityGates");
  assertKnownKeys(
    regularGates,
    ["audit", "independentReview", "check", "tryGuide"],
    "qualityGates.regular"
  );
  assertKnownKeys(
    continuousGates,
    ["audit", "independentReview", "check", "tryGuide"],
    "qualityGates.continuous"
  );
  assertKnownKeys(
    continuous,
    ["maxFeatures", "maxRepairAttempts", "finalIntegrationAudit"],
    "continuous"
  );
  assertKnownKeys(tracker, ["kind", "doc", "labels"], "tracker");
  assertKnownKeys(trackerLabels, TRACKER_LABEL_ROLES, "tracker.labels");
  assertKnownKeys(domainDocs, ["glossary", "adr"], "domainDocs");
  assertKnownKeys(
    avengers,
    [
      "maxConcurrent",
      "specApproval",
      "integrationBranchPrefix",
      "worktreeRoot",
      "serializeWhen",
      "finalIntegrationAudit",
      "portBase"
    ],
    "avengers"
  );
  assertKnownKeys(sensitive, ["patterns"], "sensitive");
  assertKnownKeys(research, ["web"], "research");
  assertKnownKeys(dataHandling, ["sourceMayLeavePremises", "approvalRecord"], "dataHandling");
  assertKnownKeys(
    models,
    ["main", "subagentDefault", "roles", "effort", "reviewerMustDiffer"],
    "models"
  );
  assertKnownKeys(modelRoles, MODEL_ROLES, "models.roles");
  assertKnownKeys(modelEffort, MODEL_ROLES, "models.effort");

  return {
    schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
    workflow: {
      stepReview: optionalEnum(
        workflow.stepReview,
        ["every", "feature"],
        defaults.workflow.stepReview,
        "workflow.stepReview"
      ),
      checkpointCommits: optionalEnum(
        workflow.checkpointCommits,
        ["disabled", "enabled"],
        defaults.workflow.checkpointCommits,
        "workflow.checkpointCommits"
      )
    },
    git: {
      landing: optionalEnum(
        git.landing,
        ["local-merge", "pull-request"],
        defaults.git.landing,
        "git.landing"
      ),
      featureBranchPrefix: optionalBranchPrefix(
        git.featureBranchPrefix,
        defaults.git.featureBranchPrefix,
        "git.featureBranchPrefix"
      ),
      fixBranchPrefix: optionalBranchPrefix(
        git.fixBranchPrefix,
        defaults.git.fixBranchPrefix,
        "git.fixBranchPrefix"
      ),
      rollbackBranchPrefix: optionalBranchPrefix(
        git.rollbackBranchPrefix,
        defaults.git.rollbackBranchPrefix,
        "git.rollbackBranchPrefix"
      )
    },
    verification: {
      logicTests: optionalEnum(
        verification.logicTests,
        ["required", "when-configured"],
        defaults.verification.logicTests,
        "verification.logicTests"
      ),
      uiEvidence: optionalEnum(
        verification.uiEvidence,
        ["required", "when-available"],
        defaults.verification.uiEvidence,
        "verification.uiEvidence"
      )
    },
    review: {
      independentExecution: optionalEnum(
        review.independentExecution,
        ["automatic", "manual"],
        defaults.review.independentExecution,
        "review.independentExecution"
      )
    },
    qualityGates: {
      regular: parseQualityGatePolicy(
        regularGates,
        defaults.qualityGates.regular,
        "qualityGates.regular"
      ),
      continuous: parseQualityGatePolicy(
        continuousGates,
        defaults.qualityGates.continuous,
        "qualityGates.continuous"
      )
    },
    continuous: {
      maxFeatures: optionalNullablePositiveInteger(
        continuous.maxFeatures,
        defaults.continuous.maxFeatures,
        "continuous.maxFeatures"
      ),
      maxRepairAttempts: optionalBoundedInteger(
        continuous.maxRepairAttempts,
        defaults.continuous.maxRepairAttempts,
        "continuous.maxRepairAttempts",
        0,
        10
      ),
      finalIntegrationAudit: optionalBoolean(
        continuous.finalIntegrationAudit,
        defaults.continuous.finalIntegrationAudit,
        "continuous.finalIntegrationAudit"
      )
    },
    profile: optionalEnum(root.profile, PROJECT_PROFILES, defaults.profile, "profile"),
    tracker: {
      kind: optionalEnum(tracker.kind, TRACKER_KINDS, defaults.tracker.kind, "tracker.kind"),
      doc: optionalRelativePath(tracker.doc, defaults.tracker.doc, "tracker.doc"),
      labels: Object.fromEntries(
        TRACKER_LABEL_ROLES.map((role) => [
          role,
          optionalNonEmptyString(
            trackerLabels[role],
            defaults.tracker.labels[role],
            `tracker.labels.${role}`
          )
        ])
      ) as Record<TrackerLabelRole, string>
    },
    domainDocs: {
      glossary: optionalRelativePath(
        domainDocs.glossary,
        defaults.domainDocs.glossary,
        "domainDocs.glossary"
      ),
      adr: optionalRelativePath(domainDocs.adr, defaults.domainDocs.adr, "domainDocs.adr")
    },
    avengers: {
      maxConcurrent: optionalBoundedInteger(
        avengers.maxConcurrent,
        defaults.avengers.maxConcurrent,
        "avengers.maxConcurrent",
        1,
        8
      ),
      specApproval: optionalEnum(
        avengers.specApproval,
        ["batch", "each"],
        defaults.avengers.specApproval,
        "avengers.specApproval"
      ),
      integrationBranchPrefix: optionalBranchPrefix(
        avengers.integrationBranchPrefix,
        defaults.avengers.integrationBranchPrefix,
        "avengers.integrationBranchPrefix"
      ),
      worktreeRoot: optionalNonEmptyString(
        avengers.worktreeRoot,
        defaults.avengers.worktreeRoot,
        "avengers.worktreeRoot"
      ),
      serializeWhen: optionalEnumList(
        avengers.serializeWhen,
        AVENGERS_SERIALIZE_REASONS,
        defaults.avengers.serializeWhen,
        "avengers.serializeWhen"
      ),
      finalIntegrationAudit: optionalBoolean(
        avengers.finalIntegrationAudit,
        defaults.avengers.finalIntegrationAudit,
        "avengers.finalIntegrationAudit"
      ),
      portBase: optionalBoundedInteger(
        avengers.portBase,
        defaults.avengers.portBase,
        "avengers.portBase",
        1024,
        65535
      )
    },
    sensitive: {
      patterns: parseSensitivePatterns(sensitive.patterns, defaults.sensitive.patterns)
    },
    research: {
      web: optionalBoolean(research.web, defaults.research.web, "research.web")
    },
    dataHandling: {
      sourceMayLeavePremises: optionalNullableEnum(
        dataHandling.sourceMayLeavePremises,
        ["yes", "no"],
        "dataHandling.sourceMayLeavePremises"
      ),
      approvalRecord: optionalNullableString(dataHandling.approvalRecord, "dataHandling.approvalRecord")
    },
    models: {
      main: optionalModel(models.main, defaults.models.main, "models.main"),
      subagentDefault: optionalModel(
        models.subagentDefault,
        defaults.models.subagentDefault,
        "models.subagentDefault"
      ),
      roles: parseModelRoles(modelRoles),
      effort: parseModelEffort(modelEffort),
      reviewerMustDiffer: optionalBoolean(
        models.reviewerMustDiffer,
        defaults.models.reviewerMustDiffer,
        "models.reviewerMustDiffer"
      )
    }
  };
}

function defaultSensitivePatterns(): Record<string, string[]> {
  return {
    payments: [
      "pesapal",
      "flutterwave",
      "paystack",
      "stripe",
      "escrow",
      "payouts?",
      "disburse",
      "refund",
      "mobile[ _-]?money",
      "\\bmomo\\b",
      "payment"
    ],
    sms: ["africa'?s[ _-]?talking", "africastalking", "\\bsms\\b", "\\bussd\\b"],
    webhooks: ["webhook"]
  };
}

// Patterns may add categories or replace a default category's list; a
// category that is left out keeps its defaults, so payments and SMS can never
// be switched off by omission.
function parseSensitivePatterns(
  value: unknown,
  fallback: Record<string, string[]>
): Record<string, string[]> {
  const result: Record<string, string[]> = Object.fromEntries(
    Object.entries(fallback).map(([category, patterns]) => [category, [...patterns]])
  );

  if (value === undefined) {
    return result;
  }

  const record = requireRecord(value, "sensitive.patterns");

  for (const [category, patterns] of Object.entries(record)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(category)) {
      throw new Error("sensitive.patterns keys must be lowercase category names such as payments.");
    }

    if (
      !Array.isArray(patterns) ||
      patterns.length === 0 ||
      patterns.some((pattern) => typeof pattern !== "string" || pattern.trim() === "")
    ) {
      throw new Error(`sensitive.patterns.${category} must be a non-empty list of patterns.`);
    }

    for (const pattern of patterns as string[]) {
      try {
        new RegExp(pattern, "i");
      } catch {
        throw new Error(`sensitive.patterns.${category} has an invalid pattern: ${pattern}`);
      }
    }

    result[category] = [...new Set([...(result[category] ?? []), ...(patterns as string[])])];
  }

  return result;
}

function optionalNullableEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} must be null or one of: ${allowed.join(", ")}.`);
  }

  return value as T;
}

function optionalNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be null or a non-empty string.`);
  }

  return value;
}

function parseModelRoles(value: Record<string, unknown>): Partial<Record<ModelRole, string>> {
  const roles: Partial<Record<ModelRole, string>> = {};

  for (const role of MODEL_ROLES) {
    if (value[role] !== undefined) {
      roles[role] = optionalModel(value[role], "inherit", `models.roles.${role}`);
    }
  }

  return roles;
}

function parseModelEffort(value: Record<string, unknown>): Partial<Record<ModelRole, ModelEffort>> {
  const effort: Partial<Record<ModelRole, ModelEffort>> = {};

  for (const role of MODEL_ROLES) {
    if (value[role] !== undefined) {
      effort[role] = optionalEnum(value[role], MODEL_EFFORTS, "medium", `models.effort.${role}`);
    }
  }

  return effort;
}

function parseLocalProjectConfig(value: unknown): LocalProjectConfig {
  const root = requireRecord(value, "local config");
  assertKnownKeys(root, ["models", "avengers"], "local config");

  const local: LocalProjectConfig = {};

  if (root.avengers !== undefined) {
    const avengers = requireRecord(root.avengers, "avengers");
    assertKnownKeys(avengers, ["maxConcurrent"], "avengers");
    local.avengers = {};

    if (avengers.maxConcurrent !== undefined) {
      local.avengers.maxConcurrent = optionalBoundedInteger(
        avengers.maxConcurrent,
        1,
        "avengers.maxConcurrent",
        1,
        8
      );
    }
  }

  if (root.models !== undefined) {
    const models = requireRecord(root.models, "models");
    assertKnownKeys(
      models,
      ["main", "subagentDefault", "roles", "effort", "reviewerMustDiffer"],
      "models"
    );
    local.models = {};

    for (const key of ["main", "subagentDefault"] as const) {
      if (models[key] !== undefined) {
        local.models[key] = optionalModel(models[key], "inherit", `models.${key}`);
      }
    }
    if (models.roles !== undefined) {
      const roles = requireRecord(models.roles, "models.roles");
      assertKnownKeys(roles, MODEL_ROLES, "models.roles");
      local.models.roles = parseModelRoles(roles);
    }
    if (models.effort !== undefined) {
      const effort = requireRecord(models.effort, "models.effort");
      assertKnownKeys(effort, MODEL_ROLES, "models.effort");
      local.models.effort = parseModelEffort(effort);
    }
    if (models.reviewerMustDiffer !== undefined) {
      local.models.reviewerMustDiffer = optionalBoolean(
        models.reviewerMustDiffer,
        true,
        "models.reviewerMustDiffer"
      );
    }
  }

  return local;
}

function isValidModel(value: string): boolean {
  if (value === "inherit" || /^claude-[a-z0-9-]+$/.test(value)) {
    return true;
  }

  const alias = value.endsWith("[1m]") ? value.slice(0, -"[1m]".length) : value;
  return MODEL_ALIASES.includes(alias);
}

function optionalModel(value: unknown, fallback: string, label: string): string {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string" || !isValidModel(value)) {
    throw new Error(
      `${label} must be inherit, one of the aliases ${MODEL_ALIASES.join(", ")} (optionally suffixed [1m]), or a full model ID such as claude-sonnet-5-5.`
    );
  }

  return value;
}

function parseQualityGatePolicy(
  value: Record<string, unknown>,
  defaults: QualityGatePolicy,
  label: string
): QualityGatePolicy {
  return {
    audit: optionalEnum(
      value.audit,
      ["always", "manual", "when-sensitive"],
      defaults.audit,
      `${label}.audit`
    ),
    independentReview: optionalEnum(
      value.independentReview,
      ["always", "manual", "when-sensitive"],
      defaults.independentReview,
      `${label}.independentReview`
    ),
    check: optionalEnum(
      value.check,
      ["always", "manual", "when-behavioral"],
      defaults.check,
      `${label}.check`
    ),
    tryGuide: optionalEnum(
      value.tryGuide,
      ["always", "manual", "when-testable", "when-user-facing"],
      defaults.tryGuide,
      `${label}.tryGuide`
    )
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> {
  return value === undefined ? {} : requireRecord(value, label);
}

function assertKnownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));

  if (unknown.length > 0) {
    throw new Error(
      `${label} contains unknown key${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`
    );
  }
}

function optionalEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  label: string
): T {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }

  return value as T;
}

function optionalBranchPrefix(
  value: unknown,
  fallback: string,
  label: string
): string {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string" || !/^[a-z][a-z0-9-]*\/$/.test(value)) {
    throw new Error(
      `${label} must be a lowercase branch prefix ending in /, such as feature/.`
    );
  }

  return value;
}

function optionalNonEmptyString(value: unknown, fallback: string, label: string): string {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function optionalRelativePath(value: unknown, fallback: string, label: string): string {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value) ||
    value.split("/").includes("..")
  ) {
    throw new Error(`${label} must be a project-relative path inside the repository.`);
  }

  return value;
}

function optionalEnumList<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[],
  label: string
): T[] {
  if (value === undefined) {
    return [...fallback];
  }

  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !allowed.includes(item as T)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} must be a list of unique values from: ${allowed.join(", ")}.`);
  }

  return [...value] as T[];
}

function optionalNullablePositiveInteger(
  value: unknown,
  fallback: number | null,
  label: string
): number | null {
  if (value === undefined) {
    return fallback;
  }

  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be null or a positive integer.`);
  }

  return value as number;
}

function optionalBoundedInteger(
  value: unknown,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) {
    return fallback;
  }

  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }

  return value as number;
}

function optionalBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${label} must be true or false.`);
  }

  return value;
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export {
  LOCAL_PROJECT_CONFIG_PATH,
  PROJECT_CONFIG_PATH,
  PROJECT_CONFIG_SCHEMA_VERSION,
  createDefaultProjectConfig,
  parseLocalProjectConfig,
  parseProjectConfig,
  readProjectConfig
};

export type {
  AuditGatePolicy,
  AvengersSerializeReason,
  AvengersSpecApproval,
  ModelEffort,
  ModelRole,
  ProjectProfile,
  TrackerKind,
  TrackerLabelRole,
  CheckpointCommitPolicy,
  CheckGatePolicy,
  IndependentReviewGatePolicy,
  IndependentReviewExecution,
  LandingPolicy,
  LocalProjectConfig,
  LogicTestPolicy,
  ProjectConfig,
  ProjectConfigResult,
  ProjectConfigState,
  ProjectConfigWarning,
  QualityGatePolicy,
  StepReviewPolicy,
  TryGuideGatePolicy,
  UiEvidencePolicy
};
