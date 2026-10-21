#!/usr/bin/env node

// Resolves the model and effort for the main agent and every subagent role,
// following reference/resolution.md exactly. Standalone ESM with no
// dependencies because installed projects may use CommonJS and do not ship the
// il-dolce-far-niente package. Run from the project root:
//   node .claude/skills/models/scripts/resolve.mjs [options]
import fs from "node:fs";
import path from "node:path";

const ROLES = [
  "planner",
  "implementer",
  "merger",
  "reviewer-lens",
  "reviewer-standards",
  "reviewer-spec",
  "explorer"
];
const REVIEWERS = ["reviewer-lens", "reviewer-standards", "reviewer-spec"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const ALIASES = ["fable", "opus", "sonnet", "haiku", "best", "opusplan"];
const FAMILIES = ["opus", "sonnet", "haiku", "fable"];
const MODEL_KEYS = ["main", "subagentDefault", "roles", "effort", "reviewerMustDiffer"];
// Documented defaults (docs/DESIGN.md) for the keys that are not per-role.
const DEFAULT_MAIN = "claude-opus-5-5";
const DEFAULT_REVIEWER_MUST_DIFFER = true;
const TEAM_PATH = "blueprint/config.json";
const LOCAL_PATH = "blueprint/config.local.json";

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const warnings = [];
  const team = readModels(readJson(TEAM_PATH) ?? {}, TEAM_PATH, warnings, false);
  const local = readModels(readJson(LOCAL_PATH) ?? {}, LOCAL_PATH, warnings, true);
  const result = resolve(options, team, local, warnings);

  if (options.role) {
    result.roles = { [options.role]: result.roles[options.role] };
  }

  console.log(options.text ? formatText(result) : JSON.stringify(result, null, 2));
}

function parseArgs(args) {
  const options = { help: false, text: false, role: null, main: null, models: {}, efforts: {} };
  const groupModel = {};
  const groupEffort = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const name = arg.replace(/^--/, "");

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--text") {
      options.text = true;
    } else if (arg === "--role") {
      options.role = readValue(args, ++index, arg);
      if (!ROLES.includes(options.role)) {
        throw new Error(`--role must be one of: ${ROLES.join(", ")}.`);
      }
    } else if (arg === "--main") {
      options.main = checkModel(readValue(args, ++index, arg), arg);
    } else if (ROLES.includes(name)) {
      options.models[name] = checkModel(readValue(args, ++index, arg), arg);
    } else if (arg === "--reviewers") {
      groupModel.value = checkModel(readValue(args, ++index, arg), arg);
    } else if (name.startsWith("effort-") && ROLES.includes(name.slice(7))) {
      options.efforts[name.slice(7)] = checkEffort(readValue(args, ++index, arg), arg);
    } else if (arg === "--effort-reviewers") {
      groupEffort.value = checkEffort(readValue(args, ++index, arg), arg);
    } else {
      throw new Error(`Unknown option: ${arg}. Run with --help.`);
    }
  }

  // A role-specific flag beats the reviewer group flag, whatever the order.
  for (const role of REVIEWERS) {
    if (groupModel.value && !options.models[role]) options.models[role] = groupModel.value;
    if (groupEffort.value && !options.efforts[role]) options.efforts[role] = groupEffort.value;
  }

  return options;
}

function readValue(args, index, flag) {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value.`);
  }
  return value;
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON. Fix it or run /models.`);
  }
}

// Returns only the model settings the file names. The team file may hold any
// workflow key (validated elsewhere); the local file may hold only models and
// avengers.maxConcurrent, and anything else is ignored with a warning.
function readModels(config, file, warnings, isLocal) {
  if (!isRecord(config)) throw new Error(`${file} must be a JSON object.`);

  if (isLocal) {
    for (const key of Object.keys(config)) {
      if (key !== "models" && key !== "avengers") {
        warnings.push(`${file}: "${key}" is not allowed in the personal file and was ignored.`);
      }
    }
    if (isRecord(config.avengers)) {
      for (const key of Object.keys(config.avengers)) {
        if (key !== "maxConcurrent") {
          warnings.push(`${file}: "avengers.${key}" is not allowed in the personal file and was ignored.`);
        }
      }
    }
  }

  if (config.models === undefined) return { roles: {}, effort: {} };
  if (!isRecord(config.models)) throw new Error(`${file}: models must be an object.`);

  const models = config.models;
  const known = (record, allowed, label) =>
    Object.keys(record).filter((key) => {
      if (allowed.includes(key)) return true;
      if (isLocal) {
        warnings.push(`${file}: "${label}.${key}" is not a known key and was ignored.`);
        return false;
      }
      throw new Error(`${file}: ${label} contains unknown key: ${key}.`);
    });

  const result = { roles: {}, effort: {} };
  for (const key of known(models, MODEL_KEYS, "models")) {
    const label = `${file}: models.${key}`;
    if (key === "main" || key === "subagentDefault") {
      result[key] = checkModel(models[key], label);
    } else if (key === "reviewerMustDiffer") {
      if (typeof models[key] !== "boolean") throw new Error(`${label} must be true or false.`);
      result[key] = models[key];
    } else {
      if (!isRecord(models[key])) throw new Error(`${label} must be an object.`);
      for (const role of known(models[key], ROLES, `models.${key}`)) {
        result[key][role] = key === "roles"
          ? checkModel(models[key][role], `${label}.${role}`)
          : checkEffort(models[key][role], `${label}.${role}`);
      }
    }
  }

  if (!isLocal) {
    const values = [
      ["models.main", result.main],
      ["models.subagentDefault", result.subagentDefault],
      ...Object.entries(result.roles).map(([role, value]) => [`models.roles.${role}`, value])
    ];
    for (const [label, value] of values) {
      if (value && isAlias(value)) {
        warnings.push(`${file}: ${label} uses the alias "${value}"; prefer a full model ID in team config.`);
      }
    }
  }

  return result;
}

function readAgentFile(role) {
  const file = path.join(process.cwd(), ".claude", "agents", `${role}.md`);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const field = (name) => {
    const line = match[1].match(new RegExp(`^${name}:[ \\t]*(.*)$`, "m"));
    const value = line?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    return value ? value : undefined;
  };
  const label = `.claude/agents/${role}.md`;
  const model = field("model");
  const effort = field("effort");
  return {
    model: model === undefined ? undefined : checkModel(model, `${label}: model`),
    effort: effort === undefined ? undefined : checkEffort(effort, `${label}: effort`)
  };
}

function resolve(options, team, local, warnings) {
  const mainModel = options.main ?? local.main ?? team.main ?? DEFAULT_MAIN;
  const mainSource = options.main ? "override" : local.main ? "local" : team.main ? "team" : "default";
  const result = {
    main: { model: mainModel, family: familyOf(mainModel), source: mainSource },
    roles: {},
    warnings
  };

  for (const role of ROLES) {
    const agent = readAgentFile(role);
    const subagentDefault = local.subagentDefault ?? team.subagentDefault;
    const model = first([
      [options.models[role], "override"],
      [local.roles[role], "local"],
      [team.roles[role], "team"],
      [subagentDefault, "subagentDefault"],
      [agent.model, "agent-file"],
      ["inherit", "inherit"]
    ]);
    const effort = first([
      [options.efforts[role], "override"],
      [local.effort[role], "local"],
      [team.effort[role], "team"],
      [agent.effort, "agent-file"],
      [null, "none"]
    ]);

    result.roles[role] = {
      model: model.value,
      family: familyOf(model.value),
      effort: effort.value,
      source: model.source,
      effortSource: effort.source
    };
  }

  const mustDiffer = local.reviewerMustDiffer ?? team.reviewerMustDiffer ?? DEFAULT_REVIEWER_MUST_DIFFER;
  if (mustDiffer) {
    const implementer = result.roles.implementer.model;
    for (const role of REVIEWERS) {
      if (result.roles[role].model === implementer) {
        warnings.push(
          `reviewerMustDiffer: ${role} resolves to ${implementer}, the same model as implementer. Choose a different reviewer model or run /models.`
        );
      }
    }
  }

  return result;
}

function first(layers) {
  const [value, source] = layers.find(([candidate]) => candidate !== undefined);
  return { value, source };
}

// The name to pass when a runtime accepts only family names. Aliases map to
// themselves (without a [1m] suffix); full IDs map to the family they name.
function familyOf(model) {
  const base = model.replace(/\[1m\]$/, "");
  if (base === "inherit" || ALIASES.includes(base)) return base;
  return FAMILIES.find((family) => base.split("-").includes(family)) ?? null;
}

function isAlias(value) {
  return ALIASES.includes(value.replace(/\[1m\]$/, ""));
}

function checkModel(value, label) {
  if (typeof value === "string" && (value === "inherit" || isAlias(value) || /^claude-[a-z0-9-]+$/.test(value))) {
    return value;
  }
  throw new Error(
    `${label} must be inherit, one of the aliases ${ALIASES.join(", ")} (optionally suffixed [1m]), or a full model ID such as claude-sonnet-5-5. Got ${JSON.stringify(value)}.`
  );
}

function checkEffort(value, label) {
  if (EFFORTS.includes(value)) return value;
  throw new Error(`${label} must be one of: ${EFFORTS.join(", ")}. Got ${JSON.stringify(value)}.`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatText(result) {
  const rows = [
    ["Role", "Model", "Family", "Effort", "Comes from"],
    ["main", result.main.model, result.main.family ?? "-", "-", result.main.source],
    ...Object.entries(result.roles).map(([role, entry]) => [
      role,
      entry.model,
      entry.family ?? "-",
      entry.effort ?? "-",
      entry.effort ? `${entry.source} / effort: ${entry.effortSource}` : entry.source
    ])
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  const lines = rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd());
  lines.splice(1, 0, widths.map((width) => "-".repeat(width)).join("  "));
  for (const warning of result.warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

function printHelp() {
  console.log(`Usage: node <skills>/models/scripts/resolve.mjs [options]

Prints the resolved model and effort for every role as JSON (run from the project root).

  --<role> <model>          per-run override (${ROLES.join(", ")})
  --reviewers <model>       override all three reviewer roles
  --effort-<role> <level>   per-run effort override (${EFFORTS.join(", ")})
  --effort-reviewers <level> effort override for all three reviewer roles
  --main <model>            per-run override for the main agent
  --role <name>             print only one role
  --text                    print a table instead of JSON`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
