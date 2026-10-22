---
name: avengers
description: Build several unblocked build-plan features in parallel as a wave, each in its own Git worktree with planner, implementer and fresh reviewer subagents, landing them one at a time onto an integration branch under single-feature gates, or resume an unfinished wave. Never pushes. Use only for /avengers, $avengers, or a direct parallel-build request.
metadata:
  internal: true
---

# avengers - build the frontier in parallel, land it serially

**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.

**First action:** Before project inspection, preflight, or any other tool call,
publish `running` to `blueprint/.state/run.json` using the dashboard activity
contract in `AGENTS.md`.

    /plan-graph  ->  [avengers]                      ->  you land the wave
    (edges in        (spec, build, prove, review,      (local merge or PR,
     build plan)      archive each item in its own      after your yes)
                      worktree; land each on wave/<n>)

Every item gets the full single-feature loop: an approved spec, small verified
steps, the configured quality gates, fresh-context review and a `/complete`
archive. Only the scheduling changes. The default branch moves only when you
approve the finished wave.

**You are a coordinator.** Scripts do the bookkeeping and subagents do the
reading. Do not load `/feature`, `/implement`, `/continuous`, `/audit` or
`/complete` yourself; the agents that need them read them. Do not open specs,
diffs or ledgers unless a script or report points you at one exact line.

## Scripts

Run from the project root. `S` is the first of `.claude/skills/avengers/scripts`
and `.agents/skills/avengers/scripts` that exists.

- `node S/avengers.mjs <command>`: `preflight`, `frontier`, `setup`, `add`,
  `state`, `verify`, `checkpoint`, `findings`, `record`, `gate`, `status`,
  `commit-evidence`, `close`. `--help` lists the options.
- `node S/land.mjs ...`: `/complete` Steps 0–2 plus the squash onto the wave.

Each prints one JSON object. Exit 0 is success; exit 2 is a stop whose `stop`
and `message` you report or act on as described below; exit 1 is a bug: stop the
run and show stderr. Never redo a script's job by hand.

## Authorization

A direct `/avengers` request authorizes, for this run only: creating the
integration branch `<integrationBranchPrefix><n>` and one worktree for it; one
feature branch and worktree per item under `avengers.worktreeRoot`; installing
the project's **existing locked** dependencies in those worktrees with the
documented frozen install command; starting subagents with the resolved models;
step, checkpoint, work and merge commits on feature branches; squash, evidence
and `reset --hard` commits on the integration branch; and deleting landed
feature branches and worktrees.

It never authorizes a commit, merge, reset or ref change on the default branch,
push, pull request, publish, deploy, remote changes, destructive data
operations, accepting findings, waiving failed checks, adding or upgrading
packages, or product decisions. Landing the wave needs a separate yes.

## Input

- `/avengers` - start a wave from the current frontier.
- `/avengers 3 5 7` - exactly these items; each must be on the frontier.
- `/avengers resume` - continue the recorded wave.
- `--max <n>`, `--autopilot` (planners self-review instead of the approval
  stop), and model overrides `--planner`, `--implementer`, `--reviewers`,
  `--merger`, `--explorer <model>`, `--effort-reviewers <level>`.

## Step 1 - preflight

Run `avengers.mjs preflight`. If `ready` is false, stop and show `problems`.
Also stop if the runtime cannot start background subagents with a per-call model
(suggest `/continuous`). In Claude Code use the agents in `.claude/agents/`; if a
type is missing, start a general subagent told to follow `.claude/agents/<role>.md`.

Keep the returned `gates`, `independentExecution`, `maxRepairAttempts`,
`finalIntegrationAudit` and `landing`; you never read the config yourself.

## Step 2 - choose and set up the wave

Take `frontier` items in plan order up to `maxConcurrent` (or `--max`). Each
frontier entry carries `sensitive`: the categories its plan line matched in
`sensitive.patterns` (payments, SMS and webhooks by default). Defer an item
whose plan line clearly overlaps an earlier pick in a non-additive way or shares
a non-pattern `serializeWhen` category with it (auth, migration, shared config);
additive registry files (an index of re-exports, a route list, a changelog)
never count as overlap. `setup` itself defers any item that shares a pattern
category in `serializeWhen` (payments and SMS by default) with an earlier pick.
Show the picks and deferrals, then run:

    avengers.mjs setup --items <ids> [--install "<frozen install command>"] [--model-args "<overrides>"]

It creates the integration branch and worktrees, assigns ports, resolves the
models (show its `warnings`; ask before continuing past a `reviewerMustDiffer`
warning) and writes the wave record. Items it `deferred` stay on the frontier.

## Step 3 - spec

Start one **planner** per item in the background, all at once. Task: worktree,
build-plan item ID, frozen branch, port, `--autopilot` if given. When all report,
present one approval packet from their compact reports (`avengers.specApproval:
"each"` means one at a time). The user approves, requests edits (relay to that
planner) or drops items. Set activity `ready` while waiting, and record each
item with `state set --id <n> --status awaiting-approval|implementing|dropped
[--question "<decision>"]`. A dropped item keeps its worktree and spec.

Re-check overlap with each report's **Files / areas**, and run
`avengers.mjs classify --id <n>` for each item; a `serializeAfter` answer means
the item now shares a serialized category (for example payments) with an
earlier one. Defer a newly conflicting later item with `state set --status
blocked --reason "overlaps <n>"` until the earlier one lands.

**Gate choice per item**, from `gates` and the planner's `Sensitive` and
`Behavioral` lines: lens review runs when `audit` or `independentReview` is
`always`, or `when-sensitive` and the item is sensitive. An item is sensitive
when the planner says so **or** the scripts found any category (`sensitive` in
`setup`, `classify` or `checkpoint`); payments and SMS always are, so never
override a script hit. Check runs when `check`
is `always`, or `when-behavioral` and the item is behavioral. A try guide is
written when `tryGuide` is `always`, `when-testable`, or `when-user-facing` and
the item is user-facing.

## Step 4 - build

Start one **implementer** per approved item in the background. Task: worktree,
branch, port, `check: required|not-required`, `try-guide: yes|no`. Handle each as
it finishes; one failure stops only its item.

## Step 5 - prove and review

For each finished item:

1. `avengers.mjs verify --id <n>`. Failure → repair (below).
2. `avengers.mjs checkpoint --id <n>` → `base`, `target`, `files`,
   `sensitive`. A new hit turns the lens review on for this item.
3. `avengers.mjs findings --id <n>`, then start **reviewer-standards** and
   **reviewer-spec** in parallel. Task: worktree, base, target, and that
   findings list. They write `blueprint/.state/avengers/review-<axis>.json`.
4. `avengers.mjs record --id <n>`.
5. When lens review applies: with `independentExecution: "automatic"`, start a
   **reviewer-lens** with the worktree, base, target and base ref
   `refs/heads/<integration branch>`; it prepares and completes the independent
   review itself. With `"manual"`, `state set --status blocked` with Audit's
   manual handoff command for that worktree and continue the wave.
6. `avengers.mjs gate --id <n> [--lens-required]`. `pass` → `state set --status
   ready-to-land`.

**Repairs.** For an open P0/P1, a failed Verify or a failed check, run
`state set --id <n> --status repairing --repair +1`; when `repairLimitReached`,
set `blocked` with the reason instead. Otherwise send the implementer back with
the finding IDs or failure, then repeat this step from 1.

## Step 6 - land one at a time

Land `ready-to-land` items in build-plan order, never two at once:

    land.mjs --worktree <item> --integration-worktree <wave> --integration-branch <wave branch> \
      --fork-point <item forkPoint> [--lens-required]

- Exit 0: report one line (item, integration commit, findings archived and
  carried). The script removed the feature worktree and branch and updated the
  wave record. Its `frontier` lists newly unblocked items: add them with
  `avengers.mjs add --items <ids>` while capacity allows; they go through Steps
  3–5, forked from the new tip.
- `stop: "conflict"`: start one **merger** with the item, the integration branch
  and the listed files. It merges the wave into the feature branch and resolves.
  When it reports resolved, repeat Step 5 for the item (its code changed), then
  land again. When it reports a decision, mark the item `blocked` with it.
- `stop: "verify-failed-integration"`: the combination broke. Both branches are
  restored; treat it as a repair with the reported tail.
- Any other stop: mark the item `blocked` with the message.

## Step 7 - integration review

When nothing is in flight or queued:

1. `avengers.mjs verify --integration`.
2. When `finalIntegrationAudit` is true, start a **reviewer-lens** in the
   integration worktree for the combined diff from the wave's `startCommit` to
   the tip, focused on cross-feature contracts, seams, security boundaries and
   regressions. Then `avengers.mjs commit-evidence`.
3. A blocking finding there gets a fix item: a branch from the integration tip,
   built, reviewed and landed like any item, then the audit runs again.

## Step 8 - stop for the user

`state wave --status ready-to-land`, set activity `ready`, and present the
report. Then ask how to land, following `landing`:

- `local-merge`: after a yes, `git merge --ff-only <wave branch>` from the main
  checkout, keeping one commit per feature.
- `pull-request`: after a yes, push the wave branch and open one pull request
  whose body follows `mp-pr`; merge it without squashing so each archive keeps
  its proof commit.

Then `avengers.mjs close` (it refuses until the wave is in the default branch)
and set activity `completed`. End by recommending `/mp-retro` on this wave while
its findings, receipts and logs are fresh; it records what it finds in
`blueprint/research/`, the findings ledger and the build plan.

## Resume

`avengers.mjs status` reports every item against Git: worktree and branch
present, current HEAD, whether the review target is still HEAD, landed commits,
and whether the default branch moved. Continue each item from its first
incomplete step; redo anything the record claims but Git does not show. A
dropped item resumes at Step 3 once its decision is answered.

## Stops

Stop the whole run, keeping every worktree, branch and commit, for invalid
config or state, a moved default branch, a hook block, an unavailable subagent
runtime, or a decision that blocks every remaining item. A problem with one item
blocks only that item.

## Report

- starting commit, integration branch and tip
- per item: branch, models requested and actual, gates run with results,
  findings by axis and severity, repairs, landing commit or block reason
- dropped and deferred items, with the exact question for each decision
- integration audit and Verify results, build-plan progress, next frontier
- the landing choice awaiting a yes, and that nothing was pushed
- the next step after landing: `/mp-retro` on this wave

## Rules

- Only `land.mjs` or the merger writes the integration branch, one at a time.
- Subagents get paths, IDs and SHAs, never pasted file contents.
- Gates never weaken: Verify, configured checks, fresh review and P0/P1 blocking
  apply to every item as in `/continuous`.
- Feature-branch commits never reach the default branch: `land.mjs` squashes
  them into one commit with its own message and no attribution. Do not rewrite
  feature-branch history (for example to strip a runtime's trailer); it only
  costs turns.
- `land.mjs` already keeps both sides of insert-only conflicts; the merger is for
  the rest.
- A blocked item with a precise reason beats a fabricated pass.

## Formatting

Follow `blueprint/context/ai-interaction.md`. One line per item state change.
