import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  defaultBranch,
  evaluate,
  findBlockedOperation,
  targetDirectory,
  tokenize
} from "../../.claude/hooks/block-remote-git.mjs";

const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude", "hooks", "block-remote-git.mjs");

/**
 * A repository laid out like an /avengers wave:
 *   <root>/main            main checkout, on `main`
 *   <root>/wt-integration  worktree on `wave/1`
 *   <root>/wt-feature      worktree on `feature/x`
 * Real worktrees (`git worktree add`) so directory resolution is exercised against git.
 */
function wave() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "idfn-hook-")));
  const main = path.join(root, "main");
  fs.mkdirSync(main);
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "t@example.com");
  git(main, "config", "user.name", "t");
  fs.writeFileSync(path.join(main, "a.txt"), "a");
  git(main, "add", ".");
  git(main, "commit", "-qm", "init");
  git(main, "branch", "wave/1");
  const integration = path.join(root, "wt-integration");
  const feature = path.join(root, "wt-feature");
  git(main, "worktree", "add", "-q", integration, "wave/1");
  git(main, "worktree", "add", "-q", "-b", "feature/x", feature, "wave/1");
  return { root, main, integration, feature, git };
}

let w;
before(() => { w = wave(); });
after(() => { fs.rmSync(w.root, { recursive: true, force: true }); });

const at = (cwd, command) => evaluate({ tool_name: "Bash", tool_input: { command }, cwd });
const blocked = (cwd, command, pattern = /./) => {
  const message = at(cwd, command);
  assert.ok(message, `expected block: ${command}`);
  assert.match(message, pattern, command);
};
const allowed = (cwd, command) => assert.equal(at(cwd, command), null, `expected allow: ${command}`);

// ---------------------------------------------------------------------------
// Kept from the original suite
// ---------------------------------------------------------------------------

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
  blocked(w.main, "git commit -am x", /default branch/);
  allowed(w.feature, "git commit -am x");
  blocked(w.feature, "cd . && git push", /git push/);
});

test("resolves the directory a command acts on", () => {
  assert.deepEqual(targetDirectory("git -C ../wt commit -m x", "/r/p"), [path.resolve("/r/wt")]);
  assert.deepEqual(targetDirectory("cd '/tmp/x y' && git merge wave/1", "/r/p"), ["/tmp/x y"]);
  assert.deepEqual(targetDirectory("git status", "/r/p"), ["/r/p"]);
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
  for (const input of ["not json", "", "null", "[]", "{}", '{"tool_name":"Bash"}', '{"tool_name":"Bash","tool_input":{"command":42}}']) {
    const result = spawnSync("node", [hook], { input, encoding: "utf8" });
    assert.equal(result.status, 0, input);
  }
  assert.equal(evaluate(null), null);
  assert.equal(evaluate({ tool_name: "Write", tool_input: { command: "git push" } }), null);
  assert.equal(evaluate({ tool_name: "Bash", tool_input: { command: "git push" }, cwd: "/does/not/exist" }) !== null, true);
});

// ---------------------------------------------------------------------------
// Bypasses found by review: must now be blocked
// ---------------------------------------------------------------------------

describe("bypass: git global options before the subcommand", () => {
  for (const command of [
    "git -c user.name=x push origin main",
    "git --no-pager push",
    "git -C a -C b push",
    "git -p push",
    "git --paginate push",
    "git --bare push",
    "git --namespace=foo push",
    "git --namespace foo push",
    "git --exec-path=/usr/lib/git-core push",
    "git --exec-path push",
    "git --git-dir=.git --work-tree=. push",
    "git --git-dir .git --work-tree . push",
    "git -c core.pager=cat -C . --no-pager push --force",
    "/usr/bin/git push",
    "command git push",
    "env GIT_TRACE=1 git push",
    "GIT_SSH_COMMAND=ssh git push"
  ]) {
    test(command, () => blocked(w.feature, command, /git push/));
  }
});

describe("bypass: moving the default branch from elsewhere", () => {
  for (const command of [
    "git branch -f main HEAD",
    "git branch --force main HEAD",
    "git branch -M x main",
    "git branch -m main old-main",
    "git branch -D main",
    "git branch -d main",
    "git branch --delete main",
    "git branch -C wave/1 main",
    "git update-ref refs/heads/main HEAD",
    "git update-ref -d refs/heads/main",
    "git update-ref --stdin",
    "git fetch . wave/1:main",
    "git fetch . +wave/1:refs/heads/main",
    "git fetch origin 'refs/heads/*:refs/heads/*'",
    "git push . x:main",
    "git checkout -B main",
    "git checkout -B main wave/1",
    "git switch -C main",
    "git switch --force-create main",
    "git worktree add -B main ../m wave/1",
    "git rebase wave/1 main",
    "git symbolic-ref refs/heads/main refs/heads/wave/1"
  ]) {
    test(command, () => blocked(w.feature, command));
  }

  test("git symbolic-ref HEAD refs/heads/main is not a move", () => {
    allowed(w.feature, "git symbolic-ref HEAD refs/heads/main");
  });
  test("but a commit after pointing HEAD at main is", () => {
    blocked(w.feature, "git symbolic-ref HEAD refs/heads/main && git commit -m x", /default branch/);
  });
});

describe("bypass: remote merges, releases and API writes", () => {
  for (const command of [
    "gh api -X PUT repos/o/r/pulls/1/merge",
    "gh api repos/o/r/pulls/1/merge -X PUT",
    "gh api --method PUT repos/o/r/pulls/1/merge",
    "gh api repos/o/r/merges -f base=main -f head=x",
    "gh api -XPOST repos/o/r/git/refs -f ref=refs/heads/x",
    "gh api graphql -f query='mutation { mergePullRequest(input:{}) { clientMutationId } }'",
    "gh pr merge",
    "gh -R o/r pr merge 3",
    "gh pr create --fill",
    "glab mr merge 4",
    "gh release create v1.0.0",
    "gh workflow run deploy.yml",
    "gh repo sync"
  ]) {
    test(command, () => blocked(w.feature, command, /not allowed/));
  }
  test("read-only gh api calls stay allowed", () => {
    allowed(w.feature, "gh api repos/o/r/pulls/1");
    allowed(w.feature, "gh api repos/o/r/pulls --jq '.[].title'");
    allowed(w.feature, "gh api graphql -f query='query { viewer { login } }'");
    allowed(w.feature, "gh pr view 3 && gh pr list && gh pr diff 3");
  });
});

describe("bypass: publish with options in between", () => {
  for (const command of [
    "npm --tag beta publish",
    "npm publish",
    "bun publish",
    "pnpm -r publish",
    "pnpm --filter pkg publish --no-git-checks",
    "yarn npm publish",
    "yarn workspaces foreach npm publish",
    "npm unpublish pkg@1.0.0",
    "npm dist-tag add pkg@1.0.0 latest",
    "npx --yes lerna publish",
    "npx semantic-release",
    "npx changeset publish",
    "cargo publish",
    "docker push registry/img:tag",
    "twine upload dist/*",
    "poetry publish"
  ]) {
    test(command, () => blocked(w.feature, command, /not allowed/));
  }
});

describe("bypass: directory resolution", () => {
  test("cd <main> then a newline then git commit", () => {
    blocked(w.feature, `cd ${w.main}\ngit commit -m x`, /default branch/);
  });
  test("cd <main>; git commit", () => blocked(w.feature, `cd ${w.main}; git commit -m x`, /default branch/));
  test("relative cd into the main checkout", () => blocked(w.feature, "cd ../main && git merge --squash feature/x", /default branch/));
  test("cd carries through later segments", () => blocked(w.feature, `cd ${w.main} && npm test && git commit -m x`, /default branch/));
  test("git -C wt status && git commit runs the second command in cwd", () => {
    blocked(w.main, `git -C ${w.feature} status && git commit -m x`, /default branch/);
    allowed(w.feature, `git -C ${w.main} status && git commit -m x`);
  });
  test("env -C dir git commit", () => blocked(w.feature, `env -C ${w.main} git commit -m x`, /default branch/));
  test("env --chdir=dir git commit", () => blocked(w.feature, `env --chdir=${w.main} git commit -m x`, /default branch/));
  test("git --git-dir=... --work-tree=... commit", () => {
    blocked(w.feature, `git --git-dir=${w.main}/.git --work-tree=${w.main} commit -m x`, /default branch/);
  });
  test("GIT_DIR=... git commit", () => blocked(w.feature, `GIT_DIR=${w.main}/.git git commit -m x`, /default branch/));
  test("export GIT_DIR then commit", () => blocked(w.feature, `export GIT_DIR=${w.main}/.git; git commit -m x`, /default branch/));
  test("pushd <main> && git reset", () => blocked(w.feature, `pushd ${w.main} && git reset --hard HEAD~1`, /default branch/));
  test("subshell (cd main && git commit)", () => blocked(w.feature, `(cd ${w.main} && git commit -m x)`, /default branch/));
  test("command substitution", () => blocked(w.feature, `echo $(cd ${w.main} && git commit -m x)`, /default branch/));
  test("backticks", () => blocked(w.feature, `echo \`cd ${w.main} && git commit -m x\``, /default branch/));
  test("substitution inside double quotes", () => blocked(w.feature, `echo "result: $(git push)"`, /git push/));
  test("bash -c string", () => blocked(w.feature, `bash -c "cd ${w.main} && git commit -m x"`, /default branch/));
  test("sh -c push", () => blocked(w.feature, "sh -c 'git push origin HEAD'", /git push/));
  test("eval", () => blocked(w.feature, "eval 'git push'", /git push/));
  test("heredoc fed to a shell", () => blocked(w.feature, "bash <<'EOF'\ngit push\nEOF", /git push/));
  test("pipe into a shell", () => blocked(w.feature, "echo 'git push' | sh", /git push/));
  test("xargs git push", () => blocked(w.feature, "echo origin | xargs git push", /git push/));
  test("find -exec", () => blocked(w.feature, "find . -maxdepth 0 -exec git push \\;", /git push/));
  test("timeout / nohup / sudo wrappers", () => {
    blocked(w.feature, "timeout 30 git push", /git push/);
    blocked(w.feature, "nohup git push &", /git push/);
    blocked(w.feature, "sudo -u me git push", /git push/);
  });
  test("checkout main then commit in the same line", () => {
    blocked(w.feature, "git checkout main && git commit -m x", /default branch/);
    blocked(w.integration, "git switch main; git merge --squash feature/x", /default branch/);
  });
  test("git alias defined inline", () => {
    blocked(w.feature, "git -c alias.p=push p", /git push/);
    blocked(w.feature, "git -c 'alias.p=!git push' p", /git push/);
  });
  test("git alias configured in the repository", () => {
    w.git(w.feature, "config", "alias.ship", "push origin HEAD");
    try {
      blocked(w.feature, "git ship", /git push/);
    } finally {
      w.git(w.feature, "config", "--unset", "alias.ship");
    }
  });
  test("cd to an undeterminable directory also checks the hook cwd", () => {
    blocked(w.main, 'cd "$SOMEWHERE" && git commit -m x', /default branch/);
  });
  test("a failed cd is assumed when the directory does not exist", () => {
    blocked(w.main, "cd /does/not/exist; git commit -m x", /default branch/);
  });
  test("|| keeps both possibilities", () => {
    blocked(w.feature, `cd ${w.main} || true; git commit -m x`, /default branch/);
  });
});

// ---------------------------------------------------------------------------
// False positives found by review: must now be allowed
// ---------------------------------------------------------------------------

describe("false positive: hyphenated subcommands", () => {
  for (const command of [
    "git merge-base HEAD wave/1",
    "git merge-base --is-ancestor wave/1 HEAD",
    "git merge-tree --write-tree wave/1 HEAD",
    "git merge-file a b c",
    "git commit-tree HEAD^{tree} -m x",
    "git reset-like-name",
    "git rebase--helper"
  ]) {
    test(command, () => allowed(w.main, command));
  }
});

describe("false positive: quoted text and heredoc bodies", () => {
  test("commit message mentioning git push (feature branch)", () => {
    allowed(w.feature, 'git commit -m "docs: never git push from agents"');
  });
  test("the same commit on the default branch is still blocked, for the right reason", () => {
    const message = at(w.main, 'git commit -m "docs: never git push from agents"');
    assert.match(message ?? "", /default branch/);
    assert.doesNotMatch(message ?? "", /git push is not allowed/);
  });
  for (const command of [
    "grep -rn 'npm publish' .",
    'grep -rn "git push" docs/',
    'echo "vercel --prod"',
    "echo 'gh pr merge 1'",
    "rg 'wrangler deploy|netlify deploy' -g '*.md'",
    "echo \"it's fine: \\\"git push\\\" stays quoted\"",
    "printf '%s\\n' 'git push origin main'",
    "cat <<'EOF'\ngit push origin main\nnpm publish\nEOF",
    "cat <<EOF > notes.txt\nrun git push yourself\nEOF\ngit status",
    "cat <<-EOF\n\tgit push\n\tEOF",
    "git log --grep='push'",
    "echo push # git push is in a comment",
    "node -e \"console.log('git push')\"",
    "git commit -m $'line one\\ngit push later'"
  ]) {
    test(JSON.stringify(command), () => allowed(w.feature, command));
  }
  test("heredoc with an unquoted delimiter still runs its substitutions", () => {
    blocked(w.feature, "cat <<EOF\n$(git push)\nEOF", /git push/);
  });
  test("commands after a heredoc are still checked", () => {
    blocked(w.feature, "cat <<'EOF' > x\nhello\nEOF\ngit push", /git push/);
  });
});

// ---------------------------------------------------------------------------
// Deploys (kept rules)
// ---------------------------------------------------------------------------

describe("deploys", () => {
  for (const command of [
    "vercel --prod",
    "vercel deploy",
    "vercel",
    "npx vercel@latest --prod --yes",
    "netlify deploy --prod",
    "fly deploy",
    "flyctl deploy --remote-only",
    "firebase deploy --only hosting",
    "wrangler deploy",
    "wrangler publish",
    "npx wrangler deploy",
    "pnpm dlx wrangler deploy",
    "bunx netlify deploy",
    "serverless deploy"
  ]) {
    test(command, () => blocked(w.feature, command, /not allowed/));
  }
  test("non-deploy invocations are allowed", () => {
    for (const command of ["vercel dev", "vercel env ls", "vercel --version", "netlify dev", "fly status", "wrangler dev", "firebase emulators:start"]) {
      allowed(w.feature, command);
    }
  });
});

// ---------------------------------------------------------------------------
// Current-branch rule (kept)
// ---------------------------------------------------------------------------

describe("history-changing commands on the default branch", () => {
  for (const command of [
    "git commit -m x",
    "git commit --amend --no-edit",
    "git merge wave/1",
    "git merge --squash feature/x",
    "git rebase wave/1",
    "git reset --hard HEAD~1",
    "git cherry-pick abc123",
    "git revert HEAD",
    "git am < x.patch",
    "git pull",
    "npm version patch"
  ]) {
    test(`${command} in the main checkout`, () => blocked(w.main, command, /default branch/));
  }
  test("in a subdirectory of the main checkout", () => {
    fs.mkdirSync(path.join(w.main, "sub"), { recursive: true });
    blocked(path.join(w.main, "sub"), "git commit -m x", /default branch/);
  });
});

// ---------------------------------------------------------------------------
// Local work that must keep working
// ---------------------------------------------------------------------------

describe("allowed local wave work", () => {
  const feature = [
    "git worktree add ../wt-y -b feature/y wave/1",
    "git worktree remove ../wt-y",
    "git worktree list",
    "git worktree prune",
    "git reset --hard wave/1",
    "git merge wave/1",
    "git rebase wave/1",
    "git commit -am 'feat: x'",
    "git diff main...HEAD",
    "git log main",
    "git log main..HEAD --oneline",
    "git show main:a.txt",
    "git checkout feature/x",
    "git switch -c feature/y wave/1",
    "git checkout -b feature/z",
    "git checkout -- a.txt",
    "git checkout main -- a.txt",
    "git restore --source main a.txt",
    "git stash && git stash pop",
    "git fetch origin",
    "git fetch . main:wave/1",
    "git branch feature/z",
    "git branch -f feature/z wave/1",
    "git branch -m feature/x feature/renamed",
    "git branch --list",
    "git branch -a --contains main",
    "git tag v0",
    "git status && git add -A && git commit -m 'feat: thing'",
    "git rev-parse --abbrev-ref HEAD",
    "git symbolic-ref --short HEAD",
    "git update-ref refs/heads/feature/z HEAD",
    "git ls-remote origin",
    "git remote -v",
    "git config user.name",
    "npm test && npm run lint",
    "npm run test -- --grep publish",
    "pnpm test --filter publish",
    "yarn run build publish-docs",
    "npm install publish-it",
    "npm install && npm run build",
    "npx vitest run",
    "pnpm test",
    "yarn test",
    "bun test",
    "gh pr view 1",
    "gh issue list",
    "cat .git/HEAD",
    "ls .git/refs/heads",
    "cat .claude/settings.json",
    "grep -r block-remote-git .claude/",
    "node --test tests/hooks/*.test.mjs",
    "echo done > /tmp/out.txt",
    "cp a.txt b.txt",
    "rm -rf node_modules dist",
    `cd ${w.integration} && git status`
  ];
  for (const command of feature) {
    test(`feature: ${command}`, () => allowed(w.feature, command));
  }

  const integration = [
    "git merge --squash feature/x",
    "git merge --squash feature/x && git commit -m 'feat: x'",
    "git branch -D feature/x",
    "git merge-base HEAD main",
    "git merge-tree --write-tree main HEAD",
    "git commit -m 'wave: land feature/x'",
    "git reset --hard HEAD~1",
    `cd ${w.feature} && git reset --hard wave/1`
  ];
  for (const command of integration) {
    test(`integration: ${command}`, () => allowed(w.integration, command));
  }

  test("read-only commands in the main checkout", () => {
    for (const command of ["git status", "git log --oneline -5", "git diff", "git worktree list", "git branch -D feature/gone", "git merge-base main wave/1"]) {
      allowed(w.main, command);
    }
  });
});

// ---------------------------------------------------------------------------
// Ref and hook-configuration tampering
// ---------------------------------------------------------------------------

describe("ref tampering through Bash", () => {
  for (const command of [
    "echo abc > .git/refs/heads/main",
    "printf x >> .git/HEAD",
    "echo 'ref: refs/heads/main' > .git/HEAD",
    "cp /tmp/sha .git/refs/heads/main",
    "mv x .git/packed-refs",
    "tee .git/packed-refs < /tmp/refs",
    "sed -i s/a/b/ .git/packed-refs",
    "sed -i.bak 's/x/y/' .git/HEAD",
    "rm .git/refs/heads/main",
    "rm -rf .git/refs",
    "rm -rf .git",
    "dd if=/dev/zero of=.git/HEAD"
  ]) {
    test(`${command} (main checkout)`, () => blocked(w.main, command, /may not modify/));
  }
  test("the main repository's refs from a worktree", () => {
    blocked(w.feature, `echo x > ${w.main}/.git/refs/heads/main`, /may not modify/);
    blocked(w.feature, `rm ${w.main}/.git/packed-refs`, /may not modify/);
  });
  test("feature refs and reads are fine", () => {
    allowed(w.feature, `cat ${w.main}/.git/refs/heads/main`);
    allowed(w.main, "echo x > .git/refs/heads/feature/x");
    allowed(w.main, "cat .git/refs/heads/main");
    allowed(w.main, "cat .git/HEAD > /tmp/head.txt");
  });
});

describe("hook configuration tampering", () => {
  for (const command of [
    "echo '' > .claude/hooks/block-remote-git.mjs",
    "rm .claude/hooks/block-remote-git.mjs",
    "mv .claude/hooks /tmp/",
    "sed -i 's/exit(2)/exit(0)/' .claude/hooks/block-remote-git.mjs",
    "cp /tmp/settings.json .claude/settings.json",
    "tee .claude/settings.local.json <<< '{}'",
    "echo '{}' > .claude/settings.local.json",
    "rm -rf .claude",
    "git rm .claude/hooks/block-remote-git.mjs",
    "git mv .claude/settings.json x.json",
    "cat x > ~/.claude/settings.json"
  ]) {
    test(command, () => blocked(w.feature, command, /may not modify/));
  }
  test("reading the configuration is fine", () => {
    allowed(w.feature, "cat .claude/hooks/block-remote-git.mjs");
    allowed(w.feature, "node .claude/hooks/block-remote-git.mjs < /dev/null");
    allowed(w.feature, "cp .claude/settings.json /tmp/copy.json");
  });
});

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

describe("tokenizer", () => {
  const words = (s) => tokenize(s).filter((t) => t.type === "word").map((t) => t.value);
  test("quotes become single words", () => {
    assert.deepEqual(words(`git commit -m "a b" 'c d'`), ["git", "commit", "-m", "a b", "c d"]);
  });
  test("escaped quotes inside double quotes", () => {
    assert.deepEqual(words(`echo "say \\"hi\\" now"`), ["echo", 'say "hi" now']);
  });
  test("heredoc bodies are not words", () => {
    assert.deepEqual(words("cat <<'EOF'\ngit push\nEOF\nls"), ["cat", "ls"]);
  });
  test("operators split commands", () => {
    const ops = tokenize("a && b || c; d | e\nf").filter((t) => t.type === "op").map((t) => t.value);
    assert.deepEqual(ops, ["&&", "||", ";", "|", "\n"]);
  });
  test("line continuations join words", () => {
    assert.deepEqual(words("git \\\n  push"), ["git", "push"]);
  });
});

describe("targetDirectory", () => {
  test("cd followed by a newline", () => {
    assert.deepEqual(targetDirectory(`cd ${w.main}\ngit commit`, "/r/p"), [w.main]);
  });
  test("a cd that may fail keeps the previous directory too", () => {
    assert.deepEqual(targetDirectory("cd /does/not/exist\ngit commit", "/r/p"), ["/r/p", "/does/not/exist"]);
  });
  test("-C applies only to its own command", () => {
    assert.deepEqual(targetDirectory("git -C /wt status && git commit", "/r/p"), ["/wt", "/r/p"]);
  });
  test("repeated -C options compose", () => {
    assert.deepEqual(targetDirectory("git -C /a -C b status", "/r/p"), ["/a/b"]);
  });
  test("env -C", () => {
    assert.deepEqual(targetDirectory("env -C /x git commit", "/r/p"), ["/x"]);
  });
});

describe("defaultBranch", () => {
  test("falls back to main", () => assert.equal(defaultBranch(w.feature), "main"));
  test("follows origin/HEAD when set", () => {
    w.git(w.main, "update-ref", "refs/remotes/origin/trunk", "HEAD");
    w.git(w.main, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    try {
      assert.equal(defaultBranch(w.feature), "trunk");
      allowed(w.main, "git commit -m x");
      blocked(w.feature, "git branch -f trunk HEAD");
    } finally {
      w.git(w.main, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
      w.git(w.main, "update-ref", "-d", "refs/remotes/origin/trunk");
    }
  });
  test("null outside a repository", () => assert.equal(defaultBranch(os.tmpdir()), null));
});

test("is fast on a typical command", () => {
  const command = `cd ${w.feature} && npm test && git add -A && git commit -m "feat: x" && git log --oneline -3`;
  at(w.feature, command);
  const start = process.hrtime.bigint();
  for (let k = 0; k < 10; k++) at(w.feature, command);
  const ms = Number(process.hrtime.bigint() - start) / 1e6 / 10;
  assert.ok(ms < 100, `took ${ms.toFixed(1)} ms`);
});
