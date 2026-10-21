#!/usr/bin/env node
/**
 * PreToolUse hook for Il Dolce Far Niente subagents (implementer, merger,
 * reviewers, planner, explorer).
 *
 * Subagents work inside their own worktree or on the integration branch
 * (`wave/<n>`). They must never reach outside the machine or move the default
 * branch. This hook blocks, for every subagent role:
 *   - pushes (any `git push`, whatever global options precede it), publishes,
 *     releases and deploys;
 *   - merging or creating pull requests and other writes through the
 *     GitHub/GitLab CLIs (`gh pr merge`, mutating `gh api`, `glab mr merge`...);
 *   - commit, merge, rebase, reset, cherry-pick, revert, am and pull while the
 *     checkout the command acts on is on the default branch;
 *   - anything that moves, renames or deletes the default branch from
 *     elsewhere (`git branch -f/-M/-D`, `git update-ref`, refspecs whose
 *     destination is the default branch, `checkout -B` / `switch -C`,
 *     `rebase <upstream> <default>`);
 *   - Bash writes to `.git/HEAD`, `.git/packed-refs`, `.git/refs/heads/<default>`
 *     and to the hook configuration (`.claude/hooks/`, `.claude/settings*`).
 *
 * How a command is read. A small shell tokenizer splits the command into
 * words, honouring single quotes, double quotes (with backslash escapes),
 * $'...' strings, backslash escapes, comments and heredocs. Quoted text and
 * heredoc bodies are therefore arguments, never commands: `git commit -m
 * "never git push"` or `grep 'npm publish'` do not match the push or publish
 * rules. Code that the shell does execute is evaluated recursively: `$(...)`
 * and backticks (also inside double quotes and unquoted heredocs), `<(...)`,
 * `sh -c` / `bash -c` / `eval` strings, heredocs or pipes fed to a shell, git
 * aliases, `find -exec`, `xargs`, `env`, `sudo`, `timeout` and similar
 * wrappers. Commands are split on `&&`, `||`, `;`, `|`, `&` and newlines; each
 * segment is checked against the directory it runs in. A `cd` carries forward
 * to later segments (not out of `( ... )` subshells or pipeline stages); after
 * `||` both possibilities are checked; a `cd` to a directory that does not
 * exist is assumed to fail unless followed by `&&`. `git -C`, `--git-dir`,
 * `GIT_DIR=` and `env -C` apply to their own command only. When a directory
 * cannot be determined (`cd "$X"`), the hook input `cwd` is used as well.
 *
 * The default branch is origin/HEAD, else `main`, else `master`, resolved in
 * the directory the command acts on.
 *
 * Known limits: this is a static reading of a shell command. It cannot see
 * what scripts, Makefiles, package.json scripts, git hooks or other programs
 * (`node -e`, `python -c`, `bash script.sh`) do internally, nor values that
 * only exist at run time (variables, `xargs` input).
 *
 * Contract (Claude Code hooks): JSON on stdin with tool_name, tool_input.command
 * and cwd. Exit code 2 blocks the tool call and shows stderr to the agent.
 * Any other failure exits 0 so a broken hook never wedges a run.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_DEPTH = 8;
const STOP = Symbol("stop");

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const OPERATORS = [
  "&&", "||", "|&", ";;&", ";;", ";&", "&>>", "&>", ">>", ">|", ">&", "<<<", "<<-", "<<", "<&", "<>",
  "(", ")", "|", ";", "&", ">", "<"
];
const REDIRECTS = new Set(["&>>", "&>", ">>", ">|", ">&", "<<<", "<<-", "<<", "<&", "<>", ">", "<"]);
const WRITE_REDIRECTS = new Set(["&>>", "&>", ">>", ">|", ">&", "<>", ">"]);

/** Index after the `)` matching an already-consumed `(`; quotes and escapes are skipped. */
function readBalanced(src, start) {
  let depth = 1;
  let j = start;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") { j += 2; continue; }
    if (ch === "'") { const e = src.indexOf("'", j + 1); j = e === -1 ? src.length : e + 1; continue; }
    if (ch === '"') {
      j++;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      j++;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return { body: src.slice(start, j), end: j + 1 };
    j++;
  }
  return { body: src.slice(start), end: src.length };
}

function readBacktick(src, start) {
  let j = start;
  while (j < src.length && src[j] !== "`") j += src[j] === "\\" ? 2 : 1;
  return { body: src.slice(start, j).replace(/\\([`\\$])/g, "$1"), end: j + 1 };
}

/** Command substitutions inside text the shell expands (double quotes, unquoted heredocs). */
function substitutions(text) {
  const subs = [];
  for (let j = 0; j < text.length; j++) {
    if (text[j] === "\\") { j++; continue; }
    if (text[j] === "$" && text[j + 1] === "(" && text[j + 2] !== "(") {
      const { body, end } = readBalanced(text, j + 2);
      subs.push(body);
      j = end - 1;
    } else if (text[j] === "`") {
      const { body, end } = readBacktick(text, j + 1);
      subs.push(body);
      j = end - 1;
    }
  }
  return subs;
}

/**
 * Split a shell command into tokens:
 *   { type: "word", value, quoted, subs }   value is the word after quote removal;
 *                                           subs are $(...)/`...`/<(...) bodies in it
 *   { type: "op", value }                   && || ; | & ( ) newline ...
 *   { type: "redir", op, target, subs, body, bodySubs }
 * Heredoc bodies are attached to their redirect and never become words.
 */
export function tokenize(src) {
  const tokens = [];
  const pendingHeredocs = [];
  let word = null;
  let pendingRedir = null;
  let i = 0;
  const n = src.length;

  const start = () => (word ??= { value: "", quoted: false, subs: [] });
  const finish = () => {
    if (!word) return;
    const w = word;
    word = null;
    if (pendingRedir) {
      pendingRedir.target = w.value;
      pendingRedir.subs = w.subs;
      pendingRedir.quotedTarget = w.quoted;
      if (pendingRedir.op === "<<" || pendingRedir.op === "<<-") pendingHeredocs.push(pendingRedir);
      pendingRedir = null;
      return;
    }
    tokens.push({ type: "word", ...w });
  };
  const readHeredocs = () => {
    for (const h of pendingHeredocs) {
      const lines = [];
      while (i < n) {
        let e = src.indexOf("\n", i);
        if (e === -1) e = n;
        const line = src.slice(i, e);
        i = e + 1;
        const cmp = (h.op === "<<-" ? line.replace(/^\t+/, "") : line).replace(/\r$/, "");
        if (cmp === h.target) break;
        lines.push(line);
      }
      h.body = lines.join("\n");
      h.bodySubs = h.quotedTarget ? [] : substitutions(h.body);
    }
    pendingHeredocs.length = 0;
  };

  while (i < n) {
    const c = src[i];
    if (c === "\\") {
      if (src[i + 1] === "\n") { i += 2; continue; }
      start();
      word.quoted = true;
      if (i + 1 < n) word.value += src[i + 1];
      i += 2;
      continue;
    }
    if (c === "\n") {
      finish();
      pendingRedir = null;
      tokens.push({ type: "op", value: "\n" });
      i++;
      if (pendingHeredocs.length) readHeredocs();
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") { finish(); i++; continue; }
    if (c === "#" && !word) { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "'") {
      start();
      word.quoted = true;
      const e = src.indexOf("'", i + 1);
      const stop = e === -1 ? n : e;
      word.value += src.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (c === "$" && src[i + 1] === "'") {
      start();
      word.quoted = true;
      let j = i + 2;
      while (j < n && src[j] !== "'") {
        if (src[j] === "\\" && j + 1 < n) {
          const e = src[j + 1];
          word.value += e === "n" ? "\n" : e === "t" ? "\t" : e;
          j += 2;
        } else word.value += src[j++];
      }
      i = j + 1;
      continue;
    }
    if (c === '"') {
      start();
      word.quoted = true;
      let j = i + 1;
      while (j < n && src[j] !== '"') {
        const ch = src[j];
        if (ch === "\\" && j + 1 < n) {
          const e = src[j + 1];
          if (e === "\n") { j += 2; continue; }
          word.value += '$`"\\'.includes(e) ? e : ch + e;
          j += 2;
        } else if (ch === "$" && src[j + 1] === "(") {
          const { body, end } = readBalanced(src, j + 2);
          if (!body.startsWith("(")) word.subs.push(body);
          word.value += src.slice(j, end);
          j = end;
        } else if (ch === "`") {
          const { body, end } = readBacktick(src, j + 1);
          word.subs.push(body);
          word.value += src.slice(j, end);
          j = end;
        } else word.value += src[j++];
      }
      i = j + 1;
      continue;
    }
    if (c === "`") {
      start();
      const { body, end } = readBacktick(src, i + 1);
      word.subs.push(body);
      word.value += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === "$" && src[i + 1] === "(") {
      start();
      const { body, end } = readBalanced(src, i + 2);
      if (!body.startsWith("(")) word.subs.push(body); // $(( arithmetic )) is not a command
      word.value += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === "$" && src[i + 1] === "{") {
      start();
      const e = src.indexOf("}", i);
      const stop = e === -1 ? n : e + 1;
      word.value += src.slice(i, stop);
      i = stop;
      continue;
    }
    if ((c === "<" || c === ">") && src[i + 1] === "(") {
      finish();
      const { body, end } = readBalanced(src, i + 2);
      tokens.push({ type: "word", value: src.slice(i, end), quoted: true, subs: [body] });
      i = end;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      if (REDIRECTS.has(op) && word && !word.quoted && /^\d+$/.test(word.value)) word = null; // `2>file`
      else finish();
      i += op.length;
      if (REDIRECTS.has(op)) {
        const r = { type: "redir", op, target: null, subs: [] };
        tokens.push(r);
        pendingRedir = r;
      } else {
        pendingRedir = null;
        tokens.push({ type: "op", value: op });
      }
      continue;
    }
    start();
    word.value += c;
    i++;
  }
  finish();
  return tokens;
}

/** Group tokens into simple commands, `(` / `)` markers, each with the separator that follows it. */
function parse(tokens) {
  const items = [];
  let cur = null;
  const flush = (sep) => {
    if (cur) { cur.sep = sep; items.push(cur); cur = null; }
    else if (sep && items.length && items.at(-1).sep == null) items.at(-1).sep = sep;
  };
  for (const t of tokens) {
    if (t.type === "word") (cur ??= { kind: "cmd", words: [], redirs: [], sep: null }).words.push(t);
    else if (t.type === "redir") (cur ??= { kind: "cmd", words: [], redirs: [], sep: null }).redirs.push(t);
    else if (t.value === "(") { flush(null); items.push({ kind: "open", sep: null }); }
    else if (t.value === ")") { flush(null); items.push({ kind: "close", sep: null }); }
    else flush(t.value);
  }
  flush(null);
  return items;
}

// ---------------------------------------------------------------------------
// Git state
// ---------------------------------------------------------------------------

function newRun(cwd, { isStatic = false, stopOnBlock = true } = {}) {
  return {
    inputCwd: path.resolve(cwd),
    isStatic,
    stopOnBlock,
    blocks: [],
    gitDirs: [],
    aliases: new Map(),
    marked: new Set(), // checkouts a command earlier in the line switches to the default branch
    dirStack: [],
    cache: new Map()
  };
}

function gitQuery(ctx, args, run) {
  const full = [...(ctx.gitDir ? ["--git-dir", ctx.gitDir] : []), ...args];
  const key = `${ctx.cwd}\0${full.join("\0")}`;
  if (run?.cache.has(key)) return run.cache.get(key);
  let out = null;
  try {
    const result = spawnSync("git", full, { cwd: ctx.cwd, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    out = result.status === 0 ? result.stdout.trim() : null;
  } catch {
    out = null;
  }
  run?.cache.set(key, out);
  return out;
}

function resolveDefault(ctx, run) {
  const head = gitQuery(ctx, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], run);
  if (head) return head.replace(/^origin\//, "");
  for (const name of ["main", "master"]) {
    if (gitQuery(ctx, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], run) !== null) return name;
  }
  return null;
}

/** Default branch of the repository at `cwd` (or `gitDir`): origin/HEAD, else main, else master. */
export function defaultBranch(cwd, gitDir) {
  return resolveDefault({ cwd, gitDir }, null);
}

function mainsFor(ctx, run) {
  if (run.isStatic) return ["main", "master"];
  const main = resolveDefault(ctx, run);
  return main ? [main] : [];
}

function isDefaultRef(name, mains) {
  if (typeof name !== "string" || !name) return false;
  const ref = name.replace(/^\+/, "");
  return mains.some((m) => {
    if (ref === m || ref === `refs/heads/${m}` || ref === `heads/${m}`) return true;
    if (!/[*?]/.test(ref)) return false;
    const re = new RegExp(`^${ref.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
    return re.test(`refs/heads/${m}`) || re.test(m);
  });
}

function isMarked(cwd, run) {
  for (const m of run.marked) if (cwd === m || cwd.startsWith(m + path.sep)) return true;
  return false;
}

/** The default branch name when `ctx` is (or will be, earlier in this line) on it; otherwise null. */
function onDefault(ctx, run) {
  if (run.isStatic) return isMarked(ctx.cwd, run) ? "main" : null;
  const main = resolveDefault(ctx, run);
  if (isMarked(ctx.cwd, run)) return main ?? "main";
  const branch = gitQuery(ctx, ["symbolic-ref", "--quiet", "--short", "HEAD"], run);
  return branch && main && branch === main ? main : null;
}

function mark(dir, run) {
  run.marked.add(path.resolve(dir));
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

function block(run, reason, message) {
  run.blocks.push({ reason, message });
  if (run.stopOnBlock) throw STOP;
}

function remote(run, what) {
  block(run, what, `${what} is not allowed for Il Dolce Far Niente subagents. Subagents stay local; the user approves anything that leaves this machine. Report back to the orchestrator instead.`);
}

function onDefaultBranch(run, main, what, dir) {
  block(run, `${what} on the default branch`, `Subagents may not commit, merge, rebase or reset on the default branch (${main}): \`${what}\` would run in ${dir}. Work in your worktree branch or the integration branch; the user lands the wave.`);
}

function movesDefault(run, main, what) {
  block(run, `${what} moves the default branch`, `Subagents may not move, rename or delete the default branch (${main}): \`${what}\`. Work in your worktree branch or the integration branch; the user lands the wave.`);
}

function tamper(run, what) {
  block(run, `modifying ${what}`, `Subagents may not modify ${what} from Bash (git refs and the hook configuration are off limits). Use git commands on your own branch, and report back to the orchestrator if the configuration needs to change.`);
}

// ---------------------------------------------------------------------------
// Protected paths
// ---------------------------------------------------------------------------

const hasGlob = (s) => /[*?[]/.test(s);

function checkProtectedPath(target, ctx, run) {
  if (typeof target !== "string" || !target) return;
  let p = target;
  if (p === "~" || p.startsWith("~/")) p = os.homedir() + p.slice(1);
  const dynamic = /[$`]/.test(p);
  const abs = dynamic ? p : path.resolve(ctx.cwd, p);
  const segs = abs.split("/");
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k].toLowerCase();
    const rest = segs.slice(k + 1).filter(Boolean);
    if (seg === ".git") {
      if (rest.length === 0) return tamper(run, `${target} (the git directory)`);
      if (/^(head|packed-refs)(\.lock)?$/i.test(rest[0]) || hasGlob(rest[0])) return tamper(run, target);
      if (rest[0] === "refs") {
        if (rest.length === 1 || hasGlob(rest[1])) return tamper(run, target);
        if (rest[1] === "heads") {
          if (rest.length === 2) return tamper(run, target);
          const name = rest.slice(2).join("/").replace(/\.lock$/, "");
          if (hasGlob(name)) return tamper(run, target);
          const root = segs.slice(0, k).join("/") || "/";
          const main = run.isStatic || dynamic ? null : resolveDefault({ cwd: root }, run);
          if ((main ? [main] : ["main", "master"]).includes(name)) return tamper(run, `${target} (the default branch ref)`);
        }
      }
    }
    if (seg === ".claude") {
      if (rest.length === 0) return tamper(run, `${target} (the Claude configuration directory)`);
      if (rest[0] === "hooks" || rest[0].startsWith("settings") || hasGlob(rest[0])) return tamper(run, `${target} (the hook configuration)`);
    }
  }
}

function splitArgs(rest, valued = new Set()) {
  const pos = [];
  const opts = [];
  const values = new Map();
  let dd = null;
  for (let k = 0; k < rest.length; k++) {
    const a = rest[k];
    if (a === "--") { dd = rest.slice(k + 1); break; }
    if (a.startsWith("-") && a !== "-") {
      opts.push(a);
      const eq = a.indexOf("=");
      if (a.startsWith("--") && eq > 0) {
        const name = a.slice(0, eq);
        values.set(name, [...(values.get(name) ?? []), a.slice(eq + 1)]);
      } else if (valued.has(a)) {
        values.set(a, [...(values.get(a) ?? []), rest[k + 1]]);
        k++;
      }
      continue;
    }
    pos.push(a);
  }
  return { pos, opts, values, dd };
}

const MODIFY_ALL = new Set(["rm", "rmdir", "unlink", "shred", "truncate", "touch", "chmod", "chown", "chgrp", "tee", "mv"]);
const MODIFY_DEST = new Set(["cp", "install", "ln", "rsync"]);

function modifierRule(name, args, ctxs, run) {
  const { pos, opts, values, dd } = splitArgs(args.slice(1), new Set(["-t", "-e", "-E", "-f", "-s"]));
  const all = [...pos, ...(dd ?? [])];
  let targets = [];
  if (MODIFY_ALL.has(name)) targets = all;
  else if (MODIFY_DEST.has(name)) {
    const dir = values.get("-t") ?? values.get("--target-directory");
    targets = dir ? dir : all.slice(-1);
  } else if (name === "sed") {
    if (opts.some((o) => (/^-[^-]*i/.test(o)) || o.startsWith("--in-place"))) targets = all;
  } else if (name === "perl") {
    if (opts.some((o) => /^-[a-zA-Z]*i/.test(o))) targets = all;
  } else if (name === "dd") {
    targets = args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3));
  }
  for (const ctx of ctxs) for (const t of targets) checkProtectedPath(t, ctx, run);
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

const GIT_VALUED_GLOBALS = new Set(["--work-tree", "--namespace", "--super-prefix", "--config-env", "--list-cmds"]);
const GIT_BUILTINS = new Set(`add am annotate apply archive bisect blame branch bugreport bundle cat-file check-attr
check-ignore check-mailmap check-ref-format checkout checkout-index cherry cherry-pick citool clean clone column
commit commit-graph commit-tree config count-objects credential describe diff diff-files diff-index diff-tree
difftool fast-export fast-import fetch fetch-pack filter-branch fmt-merge-msg for-each-ref for-each-repo
format-patch fsck gc get-tar-commit-id grep gui hash-object help hook index-pack init instaweb interpret-trailers
log ls-files ls-remote ls-tree mailinfo mailsplit maintenance merge merge-base merge-file merge-index merge-tree
mergetool mktag mktree multi-pack-index mv name-rev notes p4 pack-objects pack-refs prune prune-packed pull push
range-diff read-tree rebase receive-pack reflog remote repack replace request-pull rerere reset restore rev-list
rev-parse revert rm send-email send-pack shortlog show show-branch show-ref sparse-checkout stash status
stripspace submodule svn switch symbolic-ref tag unpack-file unpack-objects update-index update-ref
update-server-info upload-archive upload-pack var verify-commit verify-pack verify-tag version whatchanged
worktree write-tree lfs`.split(/\s+/));
const CURRENT_BRANCH_RULE = new Set(["commit", "merge", "rebase", "reset", "cherry-pick", "revert", "am", "pull", "filter-branch"]);

function resolveDir(base, dir) {
  if (dir == null || /[$`]/.test(dir) || /^~[^/]/.test(dir)) return null;
  const d = dir === "~" || dir.startsWith("~/") ? os.homedir() + dir.slice(1) : dir;
  return path.resolve(base, d);
}

function gitCommand(args, ctxs, run, depth) {
  const cDirs = [];
  const configs = [];
  let gitDirOpt = null;
  let j = 0;
  while (j < args.length) {
    const a = args[j];
    if (a === "-C") { cDirs.push(args[j + 1] ?? ""); j += 2; continue; }
    if (a === "-c") { configs.push(args[j + 1] ?? ""); j += 2; continue; }
    if (a === "--git-dir") { gitDirOpt = args[j + 1] ?? ""; j += 2; continue; }
    if (a.startsWith("--git-dir=")) { gitDirOpt = a.slice(10); j++; continue; }
    if (GIT_VALUED_GLOBALS.has(a)) { j += 2; continue; }
    if (a.startsWith("-")) { j++; continue; }
    break;
  }
  const globals = args.slice(0, j);
  const sub = args[j];
  const rest = args.slice(j + 1);
  if (!sub) return;

  const gctxs = ctxs.map((ctx) => {
    let cwd = ctx.cwd;
    for (const d of cDirs) cwd = d === "" ? cwd : resolveDir(cwd, d) ?? run.inputCwd;
    let gitDir = ctx.gitDir;
    if (gitDirOpt !== null) gitDir = resolveDir(cwd, gitDirOpt) ?? undefined;
    return { cwd, gitDir };
  });
  for (const g of gctxs) run.gitDirs.push(g.cwd);
  const what = `git ${sub}`;

  if (!GIT_BUILTINS.has(sub)) {
    const aliases = new Map(run.aliases);
    for (const c of configs) {
      const m = /^alias\.([^=]+)=(.*)$/is.exec(c);
      if (m) aliases.set(m[1].toLowerCase(), m[2]);
    }
    for (const g of gctxs) {
      let value = aliases.get(sub.toLowerCase());
      if (value === undefined && !run.isStatic) value = gitQuery(g, ["config", "--get", `alias.${sub}`], run) ?? undefined;
      if (value === undefined) continue;
      if (depth >= MAX_DEPTH) continue;
      if (value.startsWith("!")) runProgram(`${value.slice(1)} ${rest.map(shellQuote).join(" ")}`, [g], run, depth + 1);
      else {
        const words = tokenize(value).filter((t) => t.type === "word").map((t) => t.value);
        gitCommand([...globals, ...words, ...rest], ctxs, run, depth + 1);
      }
    }
    if (sub === "filter-repo") movesDefault(run, "default", "git filter-repo");
    return;
  }

  switch (sub) {
    case "push":
    case "send-email":
    case "request-pull":
      if (sub !== "request-pull") remote(run, what);
      return;
    case "svn":
      if (rest.includes("dcommit")) remote(run, "git svn dcommit");
      return;
    case "p4":
      if (rest.includes("submit")) remote(run, "git p4 submit");
      return;
    case "lfs":
      if (rest.includes("push")) remote(run, "git lfs push");
      return;
  }

  for (const g of gctxs) {
    const mains = () => mainsFor(g, run);
    const current = () => {
      const main = onDefault(g, run);
      if (main) onDefaultBranch(run, main, what, g.cwd);
    };
    switch (sub) {
      case "branch": {
        const { pos, opts } = splitArgs(rest, new Set(["-u", "--set-upstream-to", "--sort", "--format", "--points-at"]));
        const short = opts.filter((o) => /^-[a-zA-Z]+$/.test(o)).join("");
        const del = /[dD]/.test(short) || opts.includes("--delete");
        const move = /[mM]/.test(short) || opts.includes("--move");
        const copy = /[cC]/.test(short) || opts.includes("--copy");
        const force = /[fMCD]/.test(short) || opts.includes("--force");
        let targets = [];
        if (del || move) targets = pos;
        else if (copy) targets = force ? pos.slice(-1) : [];
        else if (force) targets = pos.slice(0, 1);
        const hit = targets.find((t) => isDefaultRef(t, mains()));
        if (hit) movesDefault(run, hit, `git branch ${rest.join(" ")}`);
        if (move && pos.length === 1) {
          const main = onDefault(g, run);
          if (main) movesDefault(run, main, `git branch ${rest.join(" ")}`);
        }
        break;
      }
      case "update-ref": {
        if (rest.includes("--stdin")) movesDefault(run, "default", "git update-ref --stdin (refs cannot be checked)");
        const { pos, opts } = splitArgs(rest, new Set(["-m"]));
        if (isDefaultRef(pos[0], mains())) movesDefault(run, pos[0], `git update-ref ${rest.join(" ")}`);
        if (pos[0] === "HEAD" && !opts.includes("--no-deref")) {
          const main = onDefault(g, run);
          if (main) movesDefault(run, main, `git update-ref ${rest.join(" ")}`);
        }
        break;
      }
      case "symbolic-ref": {
        const { pos } = splitArgs(rest, new Set(["-m"]));
        if (pos[0] && pos[0] !== "HEAD" && isDefaultRef(pos[0], mains())) movesDefault(run, pos[0], `git symbolic-ref ${rest.join(" ")}`);
        if (pos[0] === "HEAD" && isDefaultRef(pos[1], mains())) mark(g.cwd, run);
        break;
      }
      case "fetch":
      case "pull": {
        for (const a of rest) {
          const spec = a.replace(/^--refmap=/, "");
          if (spec.startsWith("-") || !spec.includes(":")) continue;
          const dst = spec.slice(spec.indexOf(":") + 1);
          if (isDefaultRef(dst, mains())) movesDefault(run, dst, `git ${sub} ${rest.join(" ")}`);
        }
        if (sub === "pull") current();
        break;
      }
      case "checkout":
      case "switch": {
        const valued = new Set(["-b", "-B", "-c", "-C", "--orphan", "--create", "--force-create", "--conflict", "--pathspec-from-file"]);
        const { pos, opts, values, dd } = splitArgs(rest, valued);
        const forced = [...(values.get("-B") ?? []), ...(sub === "switch" ? values.get("-C") ?? [] : []), ...(values.get("--force-create") ?? [])];
        for (let k = 0; k < rest.length; k++) if (/^-[a-zA-Z]+B$/.test(rest[k])) forced.push(rest[k + 1]);
        const hit = forced.find((b) => isDefaultRef(b, mains()));
        if (hit) movesDefault(run, hit, `git ${sub} ${rest.join(" ")}`);
        const creating = opts.some((o) => ["-b", "-B", "-c", "-C", "--orphan", "--create", "--force-create", "--detach", "-d"].includes(o) || o.startsWith("--orphan="));
        if (!creating && !(dd && dd.length) && pos.length === 1) {
          let target = pos[0];
          if (target === "-" || target === "@{-1}") {
            target = run.isStatic ? "main" : gitQuery(g, ["rev-parse", "--symbolic-full-name", "@{-1}"], run);
          }
          if (isDefaultRef(target, mains())) mark(run.isStatic ? g.cwd : gitQuery(g, ["rev-parse", "--show-toplevel"], run) ?? g.cwd, run);
        }
        break;
      }
      case "worktree": {
        if (rest[0] !== "add") break;
        const { pos, opts, values } = splitArgs(rest.slice(1), new Set(["-b", "-B", "--orphan", "--reason"]));
        const hit = (values.get("-B") ?? []).find((b) => isDefaultRef(b, mains()));
        if (hit) movesDefault(run, hit, `git worktree ${rest.join(" ")}`);
        const creating = opts.some((o) => ["-b", "-B", "--orphan", "--detach", "-d"].includes(o));
        if (!creating && pos[0]) {
          const ms = mains();
          const onMain = pos[1] ? isDefaultRef(pos[1], ms) : ms.includes(path.basename(pos[0]));
          const dir = resolveDir(g.cwd, pos[0]);
          if (onMain && dir) mark(dir, run);
        }
        break;
      }
      case "rebase": {
        const { pos, opts, values } = splitArgs(rest, new Set(["--onto", "-s", "--strategy", "-X", "--strategy-option", "-x", "--exec"]));
        for (const cmd of [...(values.get("-x") ?? []), ...(values.get("--exec") ?? [])]) runProgram(cmd, [g], run, depth + 1);
        const branch = opts.includes("--root") ? pos[0] : pos[1];
        if (isDefaultRef(branch, mains())) movesDefault(run, branch, `git rebase ${rest.join(" ")}`);
        current();
        break;
      }
      case "filter-branch": {
        if (rest.some((a) => a === "--all" || a === "--branches" || isDefaultRef(a, mains()))) movesDefault(run, "default", `git filter-branch ${rest.join(" ")}`);
        current();
        break;
      }
      case "submodule": {
        const k = rest.indexOf("foreach");
        if (k !== -1) {
          const cmd = rest.slice(k + 1).filter((a) => a !== "--recursive" && a !== "-q" && a !== "--quiet");
          runProgram(cmd.join(" "), [g], run, depth + 1);
        }
        break;
      }
      case "bisect":
        if (rest[0] === "run") execWords(rest.slice(1), [g], run, depth + 1);
        break;
      case "config": {
        const k = rest.findIndex((a) => /^alias\./i.test(a));
        if (k !== -1 && rest[k + 1] !== undefined && !rest[k + 1].startsWith("-")) run.aliases.set(rest[k].slice(6).toLowerCase(), rest[k + 1]);
        break;
      }
      case "rm":
      case "mv": {
        const { pos, dd } = splitArgs(rest);
        for (const t of [...pos, ...(dd ?? [])]) checkProtectedPath(t, g, run);
        break;
      }
      default:
        if (CURRENT_BRANCH_RULE.has(sub)) current();
    }
  }
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// Other tools
// ---------------------------------------------------------------------------

const API_VALUED = new Set(["-X", "--method", "-H", "--header", "-f", "-F", "--field", "--raw-field", "--input", "-q", "--jq", "-t", "--template", "--hostname", "-p", "--preview", "--cache"]);

function apiRule(cli, args, run) {
  const { pos, opts, values } = splitArgs(args, API_VALUED);
  const endpoint = pos[0] ?? "";
  let method = (values.get("-X") ?? values.get("--method") ?? [])[0];
  const attached = opts.find((o) => /^-X[A-Za-z]+$/.test(o));
  if (!method && attached) method = attached.slice(2);
  const fieldKeys = ["-f", "-F", "--field", "--raw-field", "--input"];
  const fields = fieldKeys.flatMap((k) => values.get(k) ?? []);
  if (args.some((a) => /\/merge(?:\b|$)/.test(a) && !a.startsWith("-"))) return remote(run, `${cli} api merge`);
  if (endpoint === "graphql") {
    if (fields.some((f) => /\bmutation\b/i.test(f ?? ""))) remote(run, `${cli} api graphql mutation`);
    return;
  }
  if (method ? method.toUpperCase() !== "GET" : fields.length > 0) remote(run, `${cli} api ${(method ?? "POST").toUpperCase()} ${endpoint}`.trim());
}

const GH_BLOCKED = { pr: ["merge", "create"], release: ["create", "upload", "edit", "delete"], repo: ["sync"], workflow: ["run"] };
const GLAB_BLOCKED = { mr: ["merge", "create"], release: ["create", "upload", "delete"] };

function forgeRule(name, args, run) {
  const rest = args.slice(1);
  const pos = [];
  for (let k = 0; k < rest.length && pos.length < 2; k++) {
    if (rest[k] === "-R" || rest[k] === "--repo") { k++; continue; }
    if (rest[k].startsWith("-")) continue;
    pos.push(rest[k]);
  }
  if (pos[0] === "api") return apiRule(name, rest.slice(rest.indexOf("api") + 1), run);
  const table = name === "gh" ? GH_BLOCKED : GLAB_BLOCKED;
  if (table[pos[0]]?.includes(pos[1])) remote(run, `${name} ${pos[0]} ${pos[1]}`);
}

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const PUBLISH_WORDS = new Set(["publish", "unpublish", "deprecate"]);
const SCRIPT_RUNNERS = new Set(["run", "run-script", "rum", "urn", "test", "t", "tst", "start", "stop", "restart", "exec", "x", "dlx", "create", "init", "install", "i", "add"]);

function packageRule(name, args, ctxs, run, depth) {
  const rest = args.slice(1);
  // `publish` anywhere among the leading words (`npm --tag beta publish`, `pnpm -r publish`,
  // `yarn workspaces foreach npm publish`), but not as an argument to a script (`npm run test -- --grep publish`).
  for (const a of rest) {
    if (a === "--" || SCRIPT_RUNNERS.has(a)) break;
    if (PUBLISH_WORDS.has(a)) return remote(run, `package ${a} (${name})`);
  }
  const k = rest.indexOf("dist-tag");
  if (k !== -1 && ["add", "rm"].includes(rest[k + 1])) return remote(run, `${name} dist-tag ${rest[k + 1]}`);
  const pos = rest.filter((a) => !a.startsWith("-"));
  if (pos[0] === "version") {
    for (const ctx of ctxs) {
      const main = onDefault(ctx, run);
      if (main) onDefaultBranch(run, main, `${name} version`, ctx.cwd);
    }
  }
  // `npm exec x`, `pnpm dlx x`, `yarn x`, `bun x`: the remaining words are a command.
  const runners = name === "npm" ? ["exec", "x"] : null;
  const start = runners ? (runners.includes(pos[0]) ? rest.indexOf(pos[0]) + 1 : -1) : rest.findIndex((a) => !a.startsWith("-"));
  if (start < 0) return;
  let cmd = rest.slice(start);
  if (name !== "npm" && ["exec", "dlx", "x"].includes(cmd[0])) cmd = cmd.slice(1);
  while (cmd.length && cmd[0].startsWith("-")) cmd = cmd.slice(cmd[0] === "--" ? 1 : 1);
  if (cmd.length && depth < MAX_DEPTH) execWords(cmd, ctxs, run, depth + 1);
}

const PUBLISHERS = {
  cargo: ["publish"], docker: ["push"], podman: ["push"], twine: ["upload"], poetry: ["publish"],
  uv: ["publish"], gem: ["push"], lerna: ["publish"], changeset: ["publish"]
};

function deployRule(name, args, run) {
  const rest = args.slice(1);
  switch (name) {
    case "vercel": {
      const pos = rest.filter((a) => !a.startsWith("-"));
      if (rest.some((a) => ["deploy", "--prod", "--production"].includes(a))) return remote(run, "Vercel deploy");
      if (!pos.length && !rest.some((a) => /^(-v|--version|-h|--help)$/.test(a))) return remote(run, "Vercel deploy");
      return;
    }
    case "netlify":
      if (rest.includes("deploy")) remote(run, "Netlify deploy");
      return;
    case "fly":
    case "flyctl":
      if (rest.includes("deploy")) remote(run, "Fly deploy");
      return;
    case "firebase":
      if (rest.some((a) => a === "deploy" || a.endsWith(":deploy"))) remote(run, "Firebase deploy");
      return;
    case "wrangler":
      if (rest.some((a) => a === "deploy" || a === "publish")) remote(run, "Cloudflare deploy");
      return;
    case "serverless":
    case "sls":
      if (rest.includes("deploy")) remote(run, "Serverless deploy");
      return;
  }
}
const DEPLOYERS = new Set(["vercel", "netlify", "fly", "flyctl", "firebase", "wrangler", "serverless", "sls"]);

// ---------------------------------------------------------------------------
// Command evaluation
// ---------------------------------------------------------------------------

const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}", "function", "coproc", "esac"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash"]);
const WRAPPERS = {
  command: { valued: [] },
  builtin: { valued: [] },
  exec: { valued: ["-a"] },
  nohup: { valued: [] },
  time: { valued: ["-f", "-o"] },
  nice: { valued: ["-n"] },
  timeout: { valued: ["-s", "-k", "--signal", "--kill-after"], positional: 1 },
  sudo: { valued: ["-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U", "-T"], chdir: ["-D", "--chdir"] },
  doas: { valued: ["-u", "-C"] },
  stdbuf: { valued: ["-i", "-o", "-e"] },
  ionice: { valued: ["-c", "-n", "-p"] },
  chronic: { valued: [] },
  unbuffer: { valued: [] },
  caffeinate: { valued: [] },
  xargs: { valued: ["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a", "--arg-file", "--delimiter", "--max-args", "--max-procs", "--max-lines", "--max-chars", "--eof", "--replace"] },
  npx: { valued: ["-p", "--package"] },
  pnpx: { valued: [] },
  bunx: { valued: ["-p", "--package"] },
  corepack: { valued: [] },
  env: { valued: ["-u", "--unset"], chdir: ["-C", "--chdir"] }
};

/** `/usr/bin/git` -> `git`, `vercel@latest` -> `vercel`, `@scope/pkg@1` -> `@scope/pkg`. */
function commandName(word) {
  const base = word.startsWith("@") ? word : path.basename(word);
  return base.replace(/(.)@[^/]*$/, "$1");
}

function dedupe(ctxs) {
  const seen = new Map();
  for (const c of ctxs) seen.set(`${c.cwd}\0${c.gitDir ?? ""}`, c);
  return [...seen.values()];
}

function withGitDir(ctxs, value) {
  if (value === undefined) return ctxs;
  return ctxs.map((c) => ({ cwd: c.cwd, gitDir: value === null ? undefined : resolveDir(c.cwd, value) ?? c.gitDir }));
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function changeDir(target, ctxs, run, sep) {
  if (target === undefined) target = os.homedir();
  if (target === "-" || /[$`]/.test(target) || /^~[^/]/.test(target)) return dedupe([...ctxs, { cwd: run.inputCwd }]);
  const out = [];
  for (const ctx of ctxs) {
    const next = { cwd: resolveDir(ctx.cwd, target), gitDir: ctx.gitDir };
    if (sep === "&&" || isDir(next.cwd)) out.push(next);
    else out.push(ctx, next);
  }
  return dedupe(out);
}

/** Evaluate one simple command given as words. Returns the shell's directory contexts afterwards. */
function execWords(words, ctxs, run, depth, extra = {}) {
  let i = 0;
  let gitDirEnv;
  while (i < words.length) {
    const w = words[i];
    if (KEYWORDS.has(w)) { i++; continue; }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(w);
    if (m) { if (m[1] === "GIT_DIR") gitDirEnv = m[2]; i++; continue; }
    break;
  }
  let args = words.slice(i);
  if (!args.length) return withGitDir(ctxs, gitDirEnv); // bare assignment persists in this shell
  let local = withGitDir(ctxs, gitDirEnv);

  for (let guard = 0; guard < 12 && args.length; guard++) {
    const name = commandName(args[0]);
    const spec = WRAPPERS[name];
    if (!spec) break;
    if ((name === "command" || name === "builtin") && args.some((a) => a === "-v" || a === "-V")) return ctxs;
    let j = 1;
    let skipPositional = spec.positional ?? 0;
    while (j < args.length) {
      const a = args[j];
      if (a === "--") { j++; break; }
      if (spec.chdir?.includes(a)) { const d = args[j + 1]; local = local.map((c) => ({ ...c, cwd: resolveDir(c.cwd, d) ?? run.inputCwd })); j += 2; continue; }
      const chdirEq = spec.chdir && a.startsWith("--chdir=") ? a.slice(8) : spec.chdir && /^-C./.test(a) && name === "env" ? a.slice(2) : null;
      if (chdirEq !== null) { local = local.map((c) => ({ ...c, cwd: resolveDir(c.cwd, chdirEq) ?? run.inputCwd })); j++; continue; }
      if (name === "env" && (a === "-S" || a === "--split-string" || a.startsWith("--split-string="))) {
        const str = a === "-S" || a === "--split-string" ? args[++j] : a.slice(15);
        const split = tokenize(str ?? "").filter((t) => t.type === "word").map((t) => t.value);
        args = [...args.slice(0, j - (a.includes("=") ? 0 : 1)), ...split, ...args.slice(j + 1)];
        j -= a.includes("=") ? 0 : 1;
        continue;
      }
      if (spec.valued.includes(a)) { j += 2; continue; }
      if (a.startsWith("-") && a !== "-") { j++; continue; }
      if (name === "env" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) {
        if (a.startsWith("GIT_DIR=")) local = withGitDir(local, a.slice(8));
        j++;
        continue;
      }
      if (skipPositional > 0) { skipPositional--; j++; continue; }
      break;
    }
    args = args.slice(j);
  }
  if (!args.length) return ctxs;

  const name = commandName(args[0]);
  switch (name) {
    case "cd":
    case "pushd": {
      const target = args.slice(1).find((a) => !/^-[LPe@]+$/.test(a));
      if (name === "pushd") run.dirStack.push(ctxs);
      if (name === "pushd" && target === undefined) return dedupe([...ctxs, { cwd: run.inputCwd }]);
      return changeDir(target, local, run, extra.sep);
    }
    case "popd":
      return run.dirStack.pop() ?? dedupe([...ctxs, { cwd: run.inputCwd }]);
    case "export":
    case "declare":
    case "typeset":
    case "local":
    case "readonly": {
      const assign = args.slice(1).find((a) => a.startsWith("GIT_DIR="));
      return assign ? withGitDir(ctxs, assign.slice(8)) : ctxs;
    }
    case "unset":
      return args.includes("GIT_DIR") ? withGitDir(ctxs, null) : ctxs;
    case "eval":
    case "watch":
      if (depth < MAX_DEPTH) runProgram(args.slice(1).filter((a, k) => name !== "watch" || !a.startsWith("-") || k > 0).join(" "), local, run, depth + 1);
      return ctxs;
    case "find": {
      for (let k = 1; k < args.length; k++) {
        if (!["-exec", "-execdir", "-ok", "-okdir"].includes(args[k])) continue;
        const cmd = [];
        for (k++; k < args.length && args[k] !== ";" && args[k] !== "+"; k++) cmd.push(args[k]);
        if (depth < MAX_DEPTH) execWords(cmd, local, run, depth + 1);
      }
      return ctxs;
    }
  }

  if (name === "git" || name === "hub") gitCommand(args.slice(1), local, run, depth);
  else if (name.startsWith("git-") && name.length > 4) gitCommand([name.slice(4), ...args.slice(1)], local, run, depth);
  else if (name === "gh" || name === "glab") forgeRule(name, args, run);
  else if (PACKAGE_MANAGERS.has(name)) packageRule(name, args, local, run, depth);
  else if (PUBLISHERS[name]) {
    const hit = args.slice(1).find((a) => PUBLISHERS[name].includes(a));
    if (hit) remote(run, `${name} ${hit}`);
  } else if (name === "semantic-release") remote(run, "semantic-release");
  else if (DEPLOYERS.has(name)) deployRule(name, args, run);
  else if (SHELLS.has(name)) shellRule(args, local, run, depth, extra);
  else if (MODIFY_ALL.has(name) || MODIFY_DEST.has(name) || ["sed", "perl", "dd"].includes(name)) modifierRule(name, args, local, run);
  return ctxs;
}

function shellRule(args, ctxs, run, depth, extra) {
  if (depth >= MAX_DEPTH) return;
  let k = 1;
  let inline = false;
  while (k < args.length && args[k].startsWith("-")) {
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(args[k])) inline = true;
    if (args[k] === "-o" || args[k] === "+o") k++;
    k++;
  }
  if (inline) { runProgram(args[k] ?? "", ctxs, run, depth + 1); return; }
  if (k < args.length) return; // `bash script.sh`: cannot see inside the script
  for (const r of extra.item?.redirs ?? []) {
    if (r.op === "<<" || r.op === "<<-") runProgram(r.body ?? "", ctxs, run, depth + 1);
    if (r.op === "<<<") runProgram(r.target ?? "", ctxs, run, depth + 1);
  }
  if (extra.pipedFrom) runProgram(extra.pipedFrom.words.slice(1).map((w) => w.value).join(" "), ctxs, run, depth + 1);
}

function runCommand(item, ctxs, run, depth, pipedFrom) {
  for (const w of item.words) for (const s of w.subs) runProgram(s, ctxs, run, depth + 1);
  for (const r of item.redirs) {
    for (const s of [...(r.subs ?? []), ...(r.bodySubs ?? [])]) runProgram(s, ctxs, run, depth + 1);
    if (WRITE_REDIRECTS.has(r.op) && r.target) for (const ctx of ctxs) checkProtectedPath(r.target, ctx, run);
  }
  return execWords(item.words.map((w) => w.value), ctxs, run, depth, { item, pipedFrom, sep: item.sep });
}

function runProgram(src, ctxs, run, depth) {
  if (depth > MAX_DEPTH || !src) return ctxs;
  const items = parse(tokenize(src));
  let cur = ctxs;
  const stack = [];
  let pipedFrom = null;
  for (const item of items) {
    if (item.kind === "open") { stack.push(cur); continue; }
    if (item.kind === "close") { cur = stack.pop() ?? cur; pipedFrom = null; continue; }
    const before = cur;
    const after = runCommand(item, before, run, depth, pipedFrom);
    pipedFrom = item.sep === "|" || item.sep === "|&" ? item : null;
    if (item.sep === "||") cur = dedupe([...before, ...after]);
    else if (item.sep === "|" || item.sep === "|&" || item.sep === "&") cur = before;
    else cur = after;
  }
  return cur;
}

// Last-resort patterns, used only if the parser itself throws.
const FALLBACK = [
  [/\bgit\b[^\n;&|]*\spush\b/, "git push"],
  [/\b(?:npm|pnpm|yarn|bun)\b[^\n;&|]*\spublish\b/, "package publish"],
  [/\b(?:gh|glab)\s+(?:pr|mr)\s+merge\b/, "pull request merge"],
  [/\b(?:vercel|netlify|fly|flyctl|firebase|wrangler)\b[^\n;&|]*\s(?:deploy|publish|--prod)\b/, "deploy"]
];

function analyze(command, cwd, options) {
  const run = newRun(cwd, options);
  try {
    runProgram(command, [{ cwd: run.inputCwd }], run, 0);
  } catch (error) {
    if (error !== STOP) {
      const hit = FALLBACK.find(([re]) => re.test(command));
      if (hit) remote({ ...run, stopOnBlock: false }, hit[1]);
    }
  }
  return run;
}

/**
 * Short reason the command is blocked, or null. With a `cwd`, checks run
 * against the live repository state there; without one, only checks that need
 * no repository run, assuming the default branch is `main` or `master`.
 */
export function findBlockedOperation(command, cwd) {
  const run = analyze(String(command ?? ""), cwd ?? process.cwd(), { isStatic: cwd === undefined });
  return run.blocks[0]?.reason ?? null;
}

/** Every directory a git invocation in `command` would act on, in order; `[cwd]` when there is none. */
export function targetDirectory(command, cwd) {
  const run = analyze(String(command ?? ""), cwd, { isStatic: true, stopOnBlock: false });
  const dirs = [...new Set(run.gitDirs)];
  return dirs.length ? dirs : [path.resolve(cwd)];
}

export function evaluate(input) {
  if (input?.tool_name !== "Bash") return null;
  const command = String(input?.tool_input?.command ?? "");
  if (!command.trim()) return null;
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  return analyze(command, cwd).blocks[0]?.message ?? null;
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
