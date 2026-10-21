// A tiny Blueprint project in a temp folder, for the /avengers script tests.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_FEATURE_STUB,
  FINDINGS_STUB,
  REVIEW_STUB,
  overviewHash
} from "../../skills/avengers/scripts/lib.mjs";

export const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills/avengers/scripts");

export function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function g(cwd, ...args) {
  return sh(cwd, "git", args);
}

const PLAN = `# Build Plan

## Your features

- [ ] 1. **Alpha thing** - adds a.txt _(after: none)_
- [ ] 2. **Beta thing** - adds b.txt _(after: none)_
- [ ] 3. **Gamma** - parent
  - [ ] 3a. **Gamma one** - first half _(after: 1)_
  - [ ] 3b. **Gamma two** - second half _(after: 1, 2)_
- [ ] 4. **Delta** - serial item
`;

const AGENTS = `# AGENTS.md

## Commands

- Verify: \`node verify.mjs\` (fails when a.txt and b.txt both say BOOM)
`;

// Verify fails when both a.txt and b.txt contain BOOM: only the combination breaks.
const VERIFY = `import fs from "node:fs";
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
if (read("a.txt").includes("BOOM") && read("b.txt").includes("BOOM")) {
  console.error("combined BOOM");
  process.exit(1);
}
`;

export function project(t, { worktreeRoot = "../wt" } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "avengers-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "repo");
  fs.mkdirSync(root);
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write("AGENTS.md", AGENTS);
  write("verify.mjs", VERIFY);
  write("shared.txt", "line one\nline two\n");
  write("blueprint/config.json", JSON.stringify({
    schemaVersion: 1,
    git: { landing: "local-merge", featureBranchPrefix: "feature/" },
    avengers: { maxConcurrent: 3, integrationBranchPrefix: "wave/", worktreeRoot, portBase: 4100 },
    models: { roles: { implementer: "claude-sonnet-5-5", "reviewer-standards": "claude-opus-5-5" } }
  }, null, 2));
  write("blueprint/project-plan.md", "# Project plan\n\nA test project.\n");
  write("blueprint/build-plan.md", PLAN);
  const hash = overviewHash(Buffer.from("# Project plan\n\nA test project.\n"), Buffer.from(PLAN));
  write("blueprint/context/project-overview.md", `# Test - Project Overview\n\n<!-- blueprint:source-hash ${hash} -->\n\nBody.\n`);
  write("blueprint/context/current-feature.md", CURRENT_FEATURE_STUB);
  write("blueprint/context/findings.md", FINDINGS_STUB);
  write("blueprint/context/review.md", REVIEW_STUB);
  write("blueprint/history/features/README.md", "# Completed features\n");
  write("blueprint/.state/.gitignore", "backups/\nstaging/\nrun.json\navengers.json\n");
  g(root, "init", "-q", "-b", "main");
  g(root, "config", "user.name", "Test");
  g(root, "config", "user.email", "test@example.com");
  g(root, "config", "commit.gpgsign", "false");
  g(root, "add", "-A");
  g(root, "commit", "-q", "-m", "chore: baseline");
  return { root, parent };
}

export function spec({ id, title, branch, steps = 2, checked = true, status = "in progress" }) {
  const lines = [
    `# Feature: ${title}`,
    "",
    `**From build-plan:** feature ${id}`,
    "**Build attempt:** 1",
    `**Status:** ${status}`,
    `**Branch:** \`${branch}\``,
    "",
    "## Goal",
    "",
    `Build ${title}.`,
    "",
    "## Build steps",
    ""
  ];
  for (let i = 1; i <= steps; i += 1) {
    lines.push(`- [${checked ? "x" : " "}] **Step ${i} - part ${i}** - do it. *Done when:* done.`);
  }
  return `${lines.join("\n")}\n`;
}

/** Act as planner + implementer: write the spec and a product file, commit. */
export function build(wt, { id, title, branch, file, content }) {
  fs.writeFileSync(path.join(wt, "blueprint/context/current-feature.md"), spec({ id, title, branch }));
  fs.writeFileSync(path.join(wt, file), content);
  g(wt, "add", "-A");
  g(wt, "commit", "-q", "-m", `feat: step work for ${title}`);
}

export function finding(id, severity, status, title, axis = "standards") {
  return `### ${id} [${severity}] ${status} - ${title}

**File:** x.txt:1
**Found:** 2026-10-21 by reviewer-${axis} (claude-opus-5-5), /avengers wave 1
**Axis:** ${axis}
**Why it matters:** because.
**Suggested fix:** fix it.
**Resolution:**`;
}
