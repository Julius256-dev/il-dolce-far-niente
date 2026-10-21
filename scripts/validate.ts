/**
 * Static contract for Il Dolce Far Niente. Run with `npm run check:static`.
 * Keeps AI Blueprint's skill rules (scripts/blueprint/validate-blueprint.ts)
 * for workflow skills and adds the rules in docs/DESIGN.md.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProjectConfig } from "../packages/il-dolce-far-niente/lib/project-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(repoRoot, "skills");
const claudeRoot = path.join(repoRoot, ".claude", "skills");
const agentsRoot = path.join(repoRoot, ".agents", "skills");

const CONTEXT_REUSE =
  "**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.";
const DESCRIPTION_LIMIT = 400;
const DESCRIPTION_BUDGET = 10_000;

const DISCIPLINES = new Set([
  "mp-tdd",
  "mp-grilling",
  "mp-domain-modeling",
  "mp-codebase-design",
  "mp-code-review",
  "mp-diagnosing-bugs",
  "mp-research",
  "mp-pr",
  "mp-writing-for-agents"
]);

const ROLES = ["planner", "implementer", "merger", "reviewer-lens", "reviewer-standards", "reviewer-spec", "explorer"];
const MODEL_PATTERN = /^(?:inherit|(?:fable|opus|sonnet|haiku|best|opusplan)(?:\[1m\])?|claude-[a-z0-9-]+)$/;

const REQUIRED_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "docs/DESIGN.md",
  "upstream.lock.json",
  "blueprint/config.json",
  "blueprint/build-plan.md",
  "blueprint/project-plan.md",
  "blueprint/context/tracker.md",
  ".claude/hooks/block-remote-git.mjs",
  ".claude-plugin/marketplace.json",
  "plugin/.claude-plugin/plugin.json",
  "packages/il-dolce-far-niente/package.json",
  "packages/il-dolce-far-niente/LICENSE",
  "LICENSES/ai-blueprint.txt",
  "LICENSES/mattpocock-skills.txt",
  ".github/workflows/validate.yml",
  ".github/workflows/upstream-sync.yml"
];

const errors: string[] = [];
const fail = (message: string): void => {
  errors.push(message);
};

async function exists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel);
      else out.push(childRel);
    }
  }
  await walk(root, "");
  return out.sort();
}

function frontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

async function checkRequiredPaths(): Promise<void> {
  for (const rel of REQUIRED_PATHS) {
    if (!(await exists(path.join(repoRoot, rel)))) fail(`Required path is missing: ${rel}`);
  }
}

function checkAdaptersUpToDate(): void {
  const result = spawnSync("npx", ["tsx", "scripts/build-adapters.ts", "--check"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) fail(`Adapter trees are stale:\n${result.stderr.trim()}`);
}

async function checkSkills(): Promise<string[]> {
  const skills = (await fs.readdir(sourceRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  let budget = 0;

  for (const skill of skills) {
    const file = path.join(sourceRoot, skill, "SKILL.md");
    const content = await fs.readFile(file, "utf8").catch(() => null);
    if (content === null) {
      fail(`skills/${skill} has no SKILL.md`);
      continue;
    }
    const fm = frontmatter(content);
    if (!fm) {
      fail(`skills/${skill}/SKILL.md has no frontmatter`);
      continue;
    }
    if (fm.name !== skill) fail(`skills/${skill}: name "${fm.name}" does not match its folder`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill) || skill.length > 64) fail(`skills/${skill}: name is not portable`);
    if (!fm.description) fail(`skills/${skill}: description is missing`);
    else {
      if (fm.description.length > DESCRIPTION_LIMIT) fail(`skills/${skill}: description is ${fm.description.length} characters (limit ${DESCRIPTION_LIMIT})`);
      budget += fm.description.length;
    }
    if (!content.includes(CONTEXT_REUSE)) fail(`skills/${skill}: missing the context-reuse line`);

    const explicitOnly = fm["disable-model-invocation"] === "true";
    if (DISCIPLINES.has(skill) && explicitOnly) fail(`skills/${skill}: disciplines must be model-invocable (remove disable-model-invocation)`);
    if (!DISCIPLINES.has(skill) && !explicitOnly) fail(`skills/${skill}: orchestrators must set disable-model-invocation: true`);

    if (skill.startsWith("mp-") && !(await exists(path.join(sourceRoot, skill, "UPSTREAM.md")))) {
      fail(`skills/${skill}: vendored skill is missing UPSTREAM.md`);
    }
    if (!(await exists(path.join(repoRoot, "evals", "routing", `${skill}.json`)))) fail(`evals/routing/${skill}.json is missing`);
  }

  if (budget > DESCRIPTION_BUDGET) fail(`Skill descriptions total ${budget} characters (budget ${DESCRIPTION_BUDGET})`);
  console.log(`  ${skills.length} skills, ${budget} description characters`);

  // Every file in skills/ must be self-contained: no pointers to repo-only docs,
  // and relative links to sibling skills must resolve.
  for (const rel of await listFiles(sourceRoot)) {
    if (!rel.endsWith(".md")) continue;
    const content = await fs.readFile(path.join(sourceRoot, rel), "utf8");
    if (/docs\/DESIGN\.md/.test(content) && !rel.endsWith("UPSTREAM.md")) fail(`skills/${rel}: points at docs/DESIGN.md, which is not installed into projects`);
    for (const match of content.matchAll(/`(\.\.\/[a-z0-9-]+\/[A-Za-z0-9_./-]+\.md)`/g)) {
      const target = path.resolve(path.dirname(path.join(sourceRoot, rel)), match[1]);
      if (!(await exists(target))) fail(`skills/${rel}: reference ${match[1]} does not resolve`);
    }
  }

  // Generated trees equal the source apart from the Claude-only flag.
  const claudeFiles = await listFiles(claudeRoot);
  const agentFiles = await listFiles(agentsRoot);
  if (claudeFiles.join("\n") !== agentFiles.join("\n")) fail("The .claude and .agents skill trees list different files");

  return skills;
}

async function checkInventories(skills: string[]): Promise<void> {
  const agents = await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
  const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
  const core = agents.match(/Core skills:\r?\n([\s\S]*?)\r?\nIn Codex/);
  if (!core) {
    fail("AGENTS.md: could not find the Core skills inventory");
    return;
  }
  const listed = [
    ...[...core[1].matchAll(/^- `([a-z0-9-]+)`/gm)].map((m) => m[1]),
    ...[...agents.matchAll(/Optional explicit-only skill: `([a-z0-9-]+)`/g)].map((m) => m[1])
  ].sort();
  const readmeListed = [...readme.matchAll(/^\| \*\*\/([a-z0-9-]+)\*\* \|/gm)].map((m) => m[1]).sort();

  for (const [label, list] of [
    ["AGENTS.md", listed],
    ["README.md command table", readmeListed]
  ] as const) {
    const missing = skills.filter((s) => !list.includes(s));
    const extra = list.filter((s) => !skills.includes(s));
    if (missing.length) fail(`${label} does not list: ${missing.join(", ")}`);
    if (extra.length) fail(`${label} lists unknown skills: ${extra.join(", ")}`);
  }

  const tracked = agents.match(/should write it when the\s+state directory exists:([\s\S]*?)Short orientation commands/);
  if (!tracked) fail("AGENTS.md: dashboard activity list not found");
  else {
    for (const m of tracked[1].matchAll(/`([a-z0-9-]+)`/g)) {
      if (!skills.includes(m[1])) fail(`AGENTS.md dashboard activity names unknown skill ${m[1]}`);
    }
    if (!tracked[1].includes("`avengers`")) fail("AGENTS.md dashboard activity must include avengers");
  }
}

async function checkExtMarkers(): Promise<void> {
  const files = ["AGENTS.md", "blueprint/build-plan.md", ...(await listFiles(sourceRoot)).map((f) => `skills/${f}`)];
  for (const rel of files) {
    if (!rel.endsWith(".md")) continue;
    const content = await fs.readFile(path.join(repoRoot, rel), "utf8");
    const begins = [...content.matchAll(/<!-- ext:begin ([a-z0-9-]+) -->/g)].map((m) => m[1]);
    const ends = [...content.matchAll(/<!-- ext:end ([a-z0-9-]+) -->/g)].map((m) => m[1]);
    if (begins.join() !== ends.join()) fail(`${rel}: ext:begin/ext:end markers are unbalanced`);
  }
}

async function checkConfig(): Promise<void> {
  const base = JSON.parse(await fs.readFile(path.join(repoRoot, "blueprint/config.json"), "utf8"));
  try {
    parseProjectConfig(base);
  } catch (error) {
    fail(`blueprint/config.json is invalid: ${(error as Error).message}`);
  }
  const profilesDir = path.join(sourceRoot, "onboard", "reference", "profiles");
  for (const file of (await fs.readdir(profilesDir)).filter((f) => f.endsWith(".json"))) {
    const profile = JSON.parse(await fs.readFile(path.join(profilesDir, file), "utf8"));
    const merged = deepMerge(base, profile.config);
    try {
      parseProjectConfig(merged);
    } catch (error) {
      fail(`profile ${file} produces an invalid config: ${(error as Error).message}`);
    }
    if (profile.config?.profile !== file.replace(/\.json$/, "")) fail(`profile ${file}: config.profile must match the file name`);
  }
}

function deepMerge(a: unknown, b: unknown): unknown {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null || Array.isArray(b)) return b;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge((a as Record<string, unknown>)[k], v);
  return out;
}

async function checkAgents(): Promise<void> {
  const dir = path.join(repoRoot, ".claude", "agents");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  for (const role of ROLES) if (!files.includes(`${role}.md`)) fail(`.claude/agents/${role}.md is missing`);
  for (const file of files) {
    const content = await fs.readFile(path.join(dir, file), "utf8");
    const fm = frontmatter(content);
    const name = file.replace(/\.md$/, "");
    if (!fm || fm.name !== name) fail(`.claude/agents/${file}: name must be ${name}`);
    if (!fm?.description) fail(`.claude/agents/${file}: description is missing`);
    if (fm?.model && !MODEL_PATTERN.test(fm.model)) fail(`.claude/agents/${file}: invalid model ${fm.model}`);
    if (ROLES.includes(name)) {
      if (!content.includes("block-remote-git.mjs")) fail(`.claude/agents/${file}: subagent roles must run the block-remote-git hook`);
      if (!/disallowedTools:\s*Agent/.test(content)) fail(`.claude/agents/${file}: subagent roles must not spawn further agents`);
    }
  }
}

async function checkPlugin(): Promise<void> {
  const market = JSON.parse(await fs.readFile(path.join(repoRoot, ".claude-plugin/marketplace.json"), "utf8"));
  const plugin = JSON.parse(await fs.readFile(path.join(repoRoot, "plugin/.claude-plugin/plugin.json"), "utf8"));
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "packages/il-dolce-far-niente/package.json"), "utf8"));
  if (plugin.name !== "il-dolce-far-niente") fail("plugin name must be il-dolce-far-niente");
  if (plugin.version !== pkg.version) fail(`plugin version ${plugin.version} differs from installer version ${pkg.version}`);
  if (!market.plugins?.some((p: { name: string }) => p.name === plugin.name)) fail("marketplace.json does not list the plugin");
}

async function main(): Promise<void> {
  console.log("Il Dolce Far Niente static contract");
  await checkRequiredPaths();
  checkAdaptersUpToDate();
  const skills = await checkSkills();
  await checkInventories(skills);
  await checkExtMarkers();
  await checkConfig();
  await checkAgents();
  await checkPlugin();

  if (errors.length) {
    console.error(`\n${errors.length} problem${errors.length === 1 ? "" : "s"}:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Static contract passed.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
