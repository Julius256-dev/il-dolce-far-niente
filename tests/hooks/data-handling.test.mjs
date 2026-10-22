import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkPrompt, checkWeb, modelEndpoint } from "../../.claude/hooks/data-handling.mjs";

const hook = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.claude/hooks/data-handling.mjs");

function project(t, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "data-handling-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "blueprint"));
  if (config !== undefined) {
    fs.writeFileSync(path.join(root, "blueprint", "config.json"), typeof config === "string" ? config : JSON.stringify(config));
  }
  return root;
}

const restricted = (dataHandling, extra = {}) => ({ schemaVersion: 1, profile: "restricted", dataHandling, ...extra });

test("non-restricted projects are never blocked", (t) => {
  assert.equal(checkPrompt(project(t, { schemaVersion: 1, profile: "client-delivery" }), {}), null);
  assert.equal(checkPrompt(project(t), {}), null);
});

test("a restricted project blocks until the written answer is recorded", (t) => {
  const root = project(t, restricted({ sourceMayLeavePremises: null }));
  assert.match(checkPrompt(root, {}), /in writing/);
  assert.match(checkPrompt(project(t, { schemaVersion: 1, profile: "restricted" }), {}), /in writing/);
});

test("'yes' allows any provider", (t) => {
  assert.equal(checkPrompt(project(t, restricted({ sourceMayLeavePremises: "yes" })), {}), null);
});

test("'no' blocks cloud endpoints and allows a local gateway", (t) => {
  const root = project(t, restricted({ sourceMayLeavePremises: "no" }));
  assert.match(checkPrompt(root, {}), /may not leave the premises/);
  assert.match(checkPrompt(root, { ANTHROPIC_BASE_URL: "https://api.anthropic.com" }), /Anthropic's API/);
  assert.match(checkPrompt(root, { ANTHROPIC_BASE_URL: "http://localhost:4000", CLAUDE_CODE_USE_BEDROCK: "1" }), /cloud provider/);
  assert.equal(checkPrompt(root, { ANTHROPIC_BASE_URL: "http://localhost:4000" }), null);
  assert.equal(checkPrompt(root, { ANTHROPIC_BASE_URL: "http://10.0.3.7:8080/v1" }), null);
  assert.match(checkPrompt(root, { ANTHROPIC_BASE_URL: "https://llm.example.org" }), /IDFN_APPROVED_MODEL_HOST/);
  assert.equal(
    checkPrompt(root, { ANTHROPIC_BASE_URL: "https://llm.example.org", IDFN_APPROVED_MODEL_HOST: "llm.example.org" }),
    null
  );
});

test("an unreadable config fails closed only for the prompt check", (t) => {
  const root = project(t, "{ not json");
  assert.match(checkPrompt(root, {}), /cannot be read/);
  assert.equal(checkWeb(root), null);
});

test("web research is blocked only when research.web is false", (t) => {
  assert.match(checkWeb(project(t, { schemaVersion: 1, research: { web: false } })), /Web research is off/);
  assert.equal(checkWeb(project(t, { schemaVersion: 1 })), null);
});

test("endpoint classification", () => {
  assert.equal(modelEndpoint({}).kind, "cloud");
  assert.equal(modelEndpoint({ ANTHROPIC_BASE_URL: "http://gateway.internal:4000" }).kind, "local");
  assert.equal(modelEndpoint({ ANTHROPIC_BASE_URL: "http://192.168.1.20" }).kind, "local");
  assert.equal(modelEndpoint({ ANTHROPIC_BASE_URL: "not a url" }).kind, "cloud");
});

test("the CLI exits 2 with the message on stderr", (t) => {
  const root = project(t, restricted({ sourceMayLeavePremises: null }, { research: { web: false } }));
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
  delete env.ANTHROPIC_BASE_URL;
  const prompt = spawnSync(process.execPath, [hook, "prompt"], { input: JSON.stringify({ prompt: "hi" }), env, encoding: "utf8" });
  assert.equal(prompt.status, 2);
  assert.match(prompt.stderr, /in writing/);
  const web = spawnSync(process.execPath, [hook, "web"], { input: JSON.stringify({ tool_name: "WebSearch" }), env, encoding: "utf8" });
  assert.equal(web.status, 2);
  const ok = spawnSync(process.execPath, [hook, "web"], { input: "{}", env: { ...env, CLAUDE_PROJECT_DIR: project(t, { schemaVersion: 1 }) }, encoding: "utf8" });
  assert.equal(ok.status, 0);
});
