#!/usr/bin/env node
/**
 * Data-handling guard for restricted projects (Il Dolce Far Niente).
 *
 *   node data-handling.mjs prompt   UserPromptSubmit: stop a prompt from reaching
 *                                   any model until the client's written answer
 *                                   is recorded, and stop prompts to a cloud API
 *                                   when source code may not leave the premises.
 *   node data-handling.mjs web      PreToolUse for WebFetch|WebSearch: block web
 *                                   research when `research.web` is false.
 *
 * Reads `blueprint/config.json` in $CLAUDE_PROJECT_DIR (or the hook input cwd).
 * The prompt check applies only when `profile` is `restricted`:
 *   - `dataHandling.sourceMayLeavePremises` null      -> block: record the answer first
 *   - "no" and the session talks to a cloud API       -> block: use a local model
 *   - "no" with ANTHROPIC_BASE_URL on a local gateway -> allow
 *   - "yes"                                           -> allow
 * A session counts as cloud when ANTHROPIC_BASE_URL is unset or points at
 * anthropic.com, or when Bedrock, Vertex or Foundry is switched on.
 *
 * Contract (Claude Code hooks): JSON on stdin; exit 2 blocks and shows stderr.
 * A config that exists but cannot be read blocks the restricted prompt check
 * (fail closed); everything else that goes wrong exits 0.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function readConfig(root) {
  const file = path.join(root, "blueprint", "config.json");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { missing: true };
  }
  try {
    return { config: JSON.parse(text) };
  } catch {
    return { invalid: true };
  }
}

const LOCAL_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.(local|lan|internal|intranet|corp|home\.arpa))$/i;

/** Where model requests from this session go: "cloud", "local" or "custom". */
export function modelEndpoint(env) {
  const truthy = (v) => v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
  if (truthy(env.CLAUDE_CODE_USE_BEDROCK) || truthy(env.CLAUDE_CODE_USE_VERTEX) || truthy(env.CLAUDE_CODE_USE_FOUNDRY)) {
    return { kind: "cloud", detail: "a cloud provider (Bedrock, Vertex or Foundry) is switched on" };
  }
  const base = env.ANTHROPIC_BASE_URL;
  if (!base) return { kind: "cloud", detail: "ANTHROPIC_BASE_URL is not set, so requests go to Anthropic's API" };
  let host;
  try {
    host = new URL(base).hostname;
  } catch {
    return { kind: "cloud", detail: `ANTHROPIC_BASE_URL (${base}) is not a valid URL` };
  }
  if (/(^|\.)anthropic\.com$/i.test(host)) return { kind: "cloud", detail: "ANTHROPIC_BASE_URL points at Anthropic's API" };
  if (LOCAL_HOSTS.test(host)) return { kind: "local", detail: `ANTHROPIC_BASE_URL points at ${host}` };
  return { kind: "custom", detail: `ANTHROPIC_BASE_URL points at ${host}` };
}

export function checkPrompt(root, env) {
  const r = readConfig(root);
  if (r.missing) return null;
  if (r.invalid) {
    return "blueprint/config.json cannot be read, so the restricted-data check cannot run. Fix the file (or run /doctor in a session the client has approved) before using an agent here.";
  }
  const c = r.config;
  if (c.profile !== "restricted") return null;
  const answer = c.dataHandling?.sourceMayLeavePremises ?? null;
  if (answer === "yes") return null;
  if (answer === null) {
    return [
      "This project uses the restricted profile and nobody has recorded whether its source code may leave the premises.",
      "Get the client's answer in writing first. Then, without an agent, set in blueprint/config.json:",
      '  "dataHandling": { "sourceMayLeavePremises": "yes" | "no", "approvalRecord": "<where the written answer is filed>" }',
      "See .claude/skills/onboard/reference/restricted.md (or the .agents copy)."
    ].join("\n");
  }
  if (answer === "no") {
    const endpoint = modelEndpoint(env);
    if (endpoint.kind === "local") return null;
    if (endpoint.kind === "custom" && env.IDFN_APPROVED_MODEL_HOST && new URL(env.ANTHROPIC_BASE_URL).hostname === env.IDFN_APPROVED_MODEL_HOST) {
      return null;
    }
    return [
      `Source code for this project may not leave the premises, but ${endpoint.detail}.`,
      "Point ANTHROPIC_BASE_URL at the locally hosted model gateway before starting the session.",
      "For an on-premises gateway with its own hostname, also set IDFN_APPROVED_MODEL_HOST to that hostname."
    ].join("\n");
  }
  return `dataHandling.sourceMayLeavePremises must be "yes", "no" or null, not ${JSON.stringify(answer)}.`;
}

export function checkWeb(root) {
  const r = readConfig(root);
  if (!r.config) return null;
  if (r.config.research?.web === false) {
    return "Web research is off for this project (research.web is false in blueprint/config.json). Use the repository, its lockfile-pinned dependencies and vendored docs instead.";
  }
  return null;
}

async function main() {
  const mode = process.argv[2];
  let input = {};
  try {
    const raw = fs.readFileSync(0, "utf8");
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const message = mode === "prompt" ? checkPrompt(root, process.env) : mode === "web" ? checkWeb(root) : null;
  if (message) {
    process.stderr.write(`${message}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => process.exit(0));
}
