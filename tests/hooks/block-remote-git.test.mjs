import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluate, findBlockedOperation, targetDirectory } from "../../.claude/hooks/block-remote-git.mjs";

const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude", "hooks", "block-remote-git.mjs");

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "idfn-hook-"));
  const run = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  run("init", "-q", "-b", "main");
  run("config", "user.email", "t@example.com");
  run("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.txt"), "a");
  run("add", ".");
  run("commit", "-qm", "init");
  return { dir, run };
}

test("blocks pushes, publishes and deploys anywhere in a command", () => {
  for (const command of [
    "git push origin feature/x",
    "git -C ../.worktrees/a push",
    "npm test && git push",
    "pnpm publish --access public",
    "gh pr merge 12 --squash",
    "vercel deploy --prod",
    "npx vercel --prod",
    "fly deploy"
  ]) {
    assert.ok(findBlockedOperation(command), command);
  }
});

test("allows ordinary local work", () => {
  for (const command of [
    "git status",
    "git diff main...HEAD",
    "git log --oneline",
    "npm run verify",
    "git worktree add ../.worktrees/a -b feature/a wave/1",
    "echo pushing ahead"
  ]) {
    assert.equal(findBlockedOperation(command), null, command);
  }
});

test("blocks commits on the default branch but not on feature branches", () => {
  const { dir, run } = repo();
  const input = (command) => ({ tool_name: "Bash", tool_input: { command }, cwd: dir });
  assert.match(evaluate(input("git commit -am x")) ?? "", /default branch/);
  run("checkout", "-qb", "feature/x");
  assert.equal(evaluate(input("git commit -am x")), null);
  assert.match(evaluate(input("cd . && git push")) ?? "", /git push/);
});

test("resolves the directory a command acts on", () => {
  assert.equal(targetDirectory("git -C ../wt commit -m x", "/r/p"), path.resolve("/r/wt"));
  assert.equal(targetDirectory("cd '/tmp/x y' && git merge wave/1", "/r/p"), "/tmp/x y");
  assert.equal(targetDirectory("git status", "/r/p"), "/r/p");
});

test("exits 2 with a message when run as a hook", () => {
  const result = spawnSync("node", [hook], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push" }, cwd: os.tmpdir() }),
    encoding: "utf8"
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not allowed/);
});

test("never blocks on malformed input", () => {
  const result = spawnSync("node", [hook], { input: "not json", encoding: "utf8" });
  assert.equal(result.status, 0);
});
