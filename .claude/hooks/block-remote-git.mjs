#!/usr/bin/env node
/**
 * PreToolUse hook for Il Dolce Far Niente subagents (implementer, merger,
 * reviewers, planner, explorer).
 *
 * Subagents work inside their own worktree or on the integration branch. They
 * must never reach outside the machine or move the default branch. This hook
 * blocks, for every subagent role:
 *   - pushes, publishes, releases and deploys;
 *   - merging a pull request through the GitHub/GitLab CLIs;
 *   - commits, merges, rebases, resets and cherry-picks while the target
 *     checkout is on the default branch.
 *
 * Contract (Claude Code hooks): JSON on stdin with tool_name, tool_input.command
 * and cwd. Exit code 2 blocks the tool call and shows stderr to the agent.
 * Any other failure exits 0 so a broken hook never wedges a run.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ALWAYS_BLOCKED = [
  { pattern: /\bgit\s+(?:-C\s+\S+\s+)?push\b/, reason: "git push" },
  { pattern: /\bgh\s+pr\s+merge\b/, reason: "gh pr merge" },
  { pattern: /\bglab\s+mr\s+merge\b/, reason: "glab mr merge" },
  { pattern: /\bgh\s+release\s+create\b/, reason: "gh release create" },
  { pattern: /\b(?:npm|pnpm)\s+publish\b/, reason: "package publish" },
  { pattern: /\byarn\s+(?:npm\s+)?publish\b/, reason: "package publish" },
  { pattern: /\bvercel\b[^\n|;&]*\s(?:--prod\b|deploy\b)/, reason: "Vercel deploy" },
  { pattern: /\bnetlify\s+deploy\b/, reason: "Netlify deploy" },
  { pattern: /\b(?:fly|flyctl)\s+deploy\b/, reason: "Fly deploy" },
  { pattern: /\bfirebase\s+deploy\b/, reason: "Firebase deploy" },
  { pattern: /\bwrangler\s+(?:deploy|publish)\b/, reason: "Cloudflare deploy" }
];

const DEFAULT_BRANCH_BLOCKED =
  /\bgit\s+(?:-C\s+\S+\s+)?(?:commit|merge|rebase|reset|cherry-pick|revert|am)\b/;

export function findBlockedOperation(command) {
  for (const rule of ALWAYS_BLOCKED) {
    if (rule.pattern.test(command)) return rule.reason;
  }
  return null;
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function defaultBranch(cwd) {
  const head = git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head) return head.replace(/^origin\//, "");
  for (const name of ["main", "master"]) {
    if (git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]) !== null) return name;
  }
  return null;
}

/** The directory a git command will act on: `git -C <dir>` or a leading `cd <dir> &&`. */
export function targetDirectory(command, cwd) {
  const gitC = command.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/);
  const cd = command.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)/);
  const raw = (gitC ?? cd)?.[1];
  if (!raw) return cwd;
  return path.resolve(cwd, raw.replace(/^["']|["']$/g, ""));
}

export function evaluate(input) {
  if (input?.tool_name !== "Bash") return null;
  const command = String(input?.tool_input?.command ?? "");
  if (!command) return null;

  const blocked = findBlockedOperation(command);
  if (blocked) {
    return `${blocked} is not allowed for Il Dolce Far Niente subagents. Subagents stay local; the user approves anything that leaves this machine. Report back to the orchestrator instead.`;
  }

  if (DEFAULT_BRANCH_BLOCKED.test(command)) {
    const dir = targetDirectory(command, input.cwd || process.cwd());
    const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const main = defaultBranch(dir);
    if (branch && main && branch === main) {
      return `Subagents may not commit, merge, rebase or reset on the default branch (${main}). Work in your worktree branch or the integration branch; the user lands the wave.`;
    }
  }
  return null;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const raw = await readStdin();
    const message = evaluate(raw ? JSON.parse(raw) : {});
    if (message) {
      process.stderr.write(message + "\n");
      process.exit(2);
    }
  } catch {
    // Never block on a hook malfunction.
  }
  process.exit(0);
}
