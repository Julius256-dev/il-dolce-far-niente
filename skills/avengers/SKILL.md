---
name: avengers
description: Build several unblocked build-plan features in parallel as a wave, each in its own Git worktree with planner, implementer and fresh reviewer subagents, landing them one at a time onto an integration branch under single-feature gates, or resume an unfinished wave. Never pushes. Use only for /avengers, $avengers, or a direct parallel-build request.
disable-model-invocation: true
---

# avengers - build the frontier in parallel, land it serially

**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.

**First action:** Before project inspection, preflight, or any other tool call,
publish `running` to `blueprint/.state/run.json` using the dashboard activity
contract in `AGENTS.md`.

Where this sits in the workflow:

    /plan-graph  ->  [avengers]                      ->  you land the wave
    (edges in        (spec, build, prove, review,      (local merge or PR,
     build plan)      archive each item in its own      after your yes)
                      worktree; land each on wave/<n>)

`/avengers` runs Blueprint's full feature loop for several items at once. Only
the scheduling changes: every item still gets a spec, small verified steps, the
configured quality gates, fresh-context review and a `/complete` archive. Each
item is archived on its own branch while its review is current, then squash-merged
onto the wave's integration branch. The default branch moves only when you
approve the finished wave.

## Authorization

A direct `/avengers` request authorizes these local actions for this run:

- create the integration branch `<integrationBranchPrefix><n>` from the local
  default branch, and one worktree for it
- create one feature branch and one worktree per wave item under
  `avengers.worktreeRoot`
- install the project's **existing locked** dependencies in each new worktree
  with the documented install command (frozen lockfile); never add or upgrade a
  package
- start subagents with the roles, models and effort resolved below
- on feature branches: step commits, review-checkpoint commits, the `/complete`
  work commit, and merging the integration tip in when a landing conflicts
- on the integration branch: squash-merge commits, evidence commits, and
  `git reset --hard HEAD~1` of a squash commit whose Verify failed
- delete landed feature branches (`git branch -D` after the checks in Step 7) and
  remove their worktrees

It does not authorize: any commit, merge, reset or ref change on the default
branch, push, pull request, publish, deploy, remote changes, destructive data
operations, irreversible migrations against shared data, accepting findings,
waiving failed checks, or product decisions. Landing the wave needs a separate
yes in the current chat.

## Input

- `/avengers` - start a wave from the current frontier.
- `/avengers 3 5 7` - start a wave with exactly these items; each must be on the
  frontier.
- `/avengers resume` - continue the recorded wave (see "Resume").
- Options: `--max <n>` caps this wave below `avengers.maxConcurrent`;
  `--autopilot` replaces the spec-approval stop with self-review (like
  `/autopilot`); per-run model overrides `--planner`, `--implementer`,
  `--reviewers`, `--merger`, `--explorer <model>` and `--effort-reviewers <level>`.

## Step 1 - preflight once

Read `AGENTS.md`, `blueprint/config.json` (and `blueprint/config.local.json` when
present), `blueprint/build-plan.md`, `blueprint/context/project-overview.md`,
`blueprint/context/current-feature.md`, `blueprint/context/findings.md`, and the
Git state: branch, status, default branch, `git worktree list`, recent log.

Start only when all hold, otherwise stop with the exact fix:

- The config is valid (invalid → `/doctor`). `avengers.maxConcurrent` of `1`
  means parallel builds are off for this project: stop and suggest `/continuous`.
- The main checkout is clean on the default branch and
  `blueprint/context/current-feature.md` is empty. `/avengers` never adopts or
  overwrites active single-feature work.
- No P0 or P1 finding is `open` or `fixed`.
- A `Verify` command is documented under Commands in `AGENTS.md`. Parallel
  landings cannot be proven safe without it: stop and point to `/ci`.
- The overview is current, as `/continuous` requires.
- The runtime can start **background subagents** with a per-call model and wait
  for them. In Claude Code use the project agents in `.claude/agents/`
  (`planner`, `implementer`, `merger`, `reviewer-lens`, `reviewer-standards`,
  `reviewer-spec`, `explorer`); if an agent type is missing, start a general
  subagent and tell it to read and follow `.claude/agents/<role>.md`. If the
  runtime cannot run subagents in parallel, stop and suggest `/continuous`.
- Models resolve: run the first of `node .claude/skills/models/scripts/resolve.mjs`
  or `node .agents/skills/models/scripts/resolve.mjs` with any per-run overrides,
  as `../models/reference/resolution.md` describes. Stop on an error; show its
  warnings and ask before continuing past a `reviewerMustDiffer` warning.

Record the starting default-branch commit; it bounds the integration audit and
the report. Publish activity with boundary `local-only`.

## Step 2 - choose the wave

Build the frontier from the build plan. Before the wave exists, read the main
checkout's `blueprint/build-plan.md`; once it exists, read the **integration
worktree's** copy, because landings tick items there.

- A leaf with `_(after: a, b)_` is unblocked when every named item is checked
  (a named parent waits for all of its leaves).
- `_(after: none)_` is always unblocked.
- A leaf with **no suffix** depends on every earlier unchecked leaf, so it is
  unblocked only when no unchecked leaf comes before it.
- An item already in the wave, dropped or blocked in this run is not a candidate.

Take frontier items in plan order up to the cap. For each, apply the read-only
`/brief` behavior to predict its files and areas and whether it touches auth,
payments, personal data, migrations, shared config or another sensitive category.

**Overlap check.** Two candidates conflict when they would make non-additive
changes to the same files or areas, or when both fall in a category listed in
`avengers.serializeWhen` (`sensitive` covers every category `/continuous` treats
as sensitive). **Additive registry files do not conflict**: files where each item
only appends its own distinct lines (an `index` file re-exporting modules, a
route or command list, a changelog). Keep the earlier conflicting item and defer
the later one; it stays on the frontier. Show the chosen items, deferred items
and why. A wave of one is fine.

## Step 3 - set up worktrees

Choose the next wave number `n` from existing `<integrationBranchPrefix>*`
branches. Then:

1. Create the integration branch from the default branch and its worktree:
   `git worktree add -b <prefix><n> <worktreeRoot>/<repo>-wave-<n> <default-branch>`.
2. For each item, derive the branch exactly as `/feature` does (configured
   feature prefix, kebab-case title, attempt rules in
   `../feature/reference/build-history.md`), then create it from the current
   integration tip: `git worktree add -b <branch> <worktreeRoot>/<repo>-<slug> <prefix><n>`.
   Record the tip as the item's **fork point**.
3. Give each item a slot and port: `PORT = avengers.portBase + slot`. Pass it to
   every subagent working in that worktree; any dev server or `/check` run there
   uses that port. Never edit committed env files to do this.
4. Install existing locked dependencies in each worktree when the project needs
   them to build or test.

Write the wave record to `blueprint/.state/avengers.json` in the main checkout
using `reference/wave-state.md`. Update it at every state change below.

## Step 4 - spec every item

Start one **planner** subagent per item, in the background, all at once. Each
task names: the worktree path, the build-plan item, the frozen branch name, the
integration branch, and the resolved planner model. Planners write only
`blueprint/context/current-feature.md` in their own worktree.

When all planners report, present **one approval packet** (`avengers.specApproval:
"batch"`): per item its goal, steps, files/areas, done-whens, test seams, and any
decision the planner could not make. The user approves all or some, requests
edits (relay to that planner and re-present), or drops items. With `"each"`,
approve specs one at a time. With `--autopilot`, self-review each spec like
`/continuous` step 2.1 instead of stopping.

Set activity to `ready` while waiting. An item with an unanswered product, data,
auth, billing or visual decision is **dropped** for this run; its worktree and
draft spec are kept and its build-plan item stays unchecked.

After approval, repeat the overlap check with each spec's real **Files / areas**.
A newly found conflict defers the later item until the earlier one lands.

## Step 5 - build in parallel

Start one **implementer** subagent per approved item, in the background. Each
task names: worktree, branch, port, resolved implementer model, and the Verify
command. Implementers follow `.claude/agents/implementer.md`: the Build loop only,
a commit per passing step, and the full Verify before reporting done. They never
merge the integration branch on their own.

Handle implementers as they finish; do not wait for the slowest. A failed or
blocked implementer stops only its own item.

## Step 6 - prove and review each item

For each finished item, inside its worktree, in this order:

1. **Verify.** Rerun the documented Verify command yourself. A failure goes back
   to the implementer as a repair.
2. **Check.** Apply `qualityGates.continuous.check` as `/continuous` does; a
   required check runs `/check` behavior in that worktree on its port.
3. **Review checkpoint.** Set the spec status to `verified` and commit the
   review checkpoint `/continuous` describes. Its full SHA is the **target**;
   the item's fork point is the **base**. The diff under review is
   `base..target`: this item's changes only.
4. **Axis review, in parallel.** Start a **reviewer-standards** and a
   **reviewer-spec** subagent with base, target, and the list of existing
   findings in that worktree's ledger (ID, axis, severity, status, title). They
   write nothing. They return new findings as ready ledger blocks, and a verdict
   for every existing `fixed` finding on their axis: `closed` (the repair works
   and introduced nothing new), `open` (still broken) or `invalid` (the finding
   was wrong), each with evidence. They never re-report an existing entry.
   These two axes always run in `/avengers`, because no human watches each step.
5. **Record the axis results.** Append new blocks to the worktree's
   `blueprint/context/findings.md` with the next free IDs, keeping each
   `**Axis:**` line and naming the reviewer and model under **Found**. Apply each
   verdict to its entry's status and **Resolution** exactly as returned. You
   record; you never judge or edit a finding yourself.
6. **Lens review.** When `qualityGates.continuous` selects audit or independent
   review for the item (as `/continuous` decides), prepare the request with
   `/audit independent current` Phase A in that worktree, using the integration
   branch as the base ref. With `review.independentExecution: "automatic"`,
   start one **reviewer-lens** subagent to perform Phase B; it writes the
   receipt and may close or reopen any finding it re-examines. With `"manual"`,
   mark the item `blocked` with Audit's manual handoff command for that worktree
   and continue the rest of the wave.
7. **Pass.** The item passes when no P0 or P1 is `open` or `fixed` in its ledger
   and, when lens review ran, its receipt is `passed` for the current target.
8. **Try guide.** Apply `qualityGates.continuous.tryGuide` as `/continuous` does.

**Repairs.** For a P0 or P1 that is `open`, or a failed Verify or Check, send the
implementer back with the finding IDs. It repairs within scope and marks them
`fixed`. Repeat this step from 1 with a new checkpoint; reviewers review the whole
new delta and give verdicts on the `fixed` entries. After
`continuous.maxRepairAttempts` attempts on the same failure, mark the item
`blocked` and keep the rest of the wave going.

## Step 7 - land one at a time

Items that passed queue for landing in build-plan order. Start **one** **merger**
subagent at a time, never two. Its task names the item's worktree, branch, fork
point, integration branch and worktree, and the Verify command. Following
`.claude/agents/merger.md`, it:

1. In the feature worktree, confirms the spec is `verified`, every step is
   checked, the tree is clean except `blueprint/context/findings.md` and
   `blueprint/context/review.md`, and a required receipt targets the current
   `HEAD`.
2. Applies `/complete` Steps 0–2 there, with the completion annotation's
   `landing` set to `wave-merge`, `baseRef` to the integration branch's full ref
   and `baseCommit` to the item's fork point. This archives the spec, findings
   and receipt while the review is current, ticks the item, resets live
   evidence, and makes the work commit on the feature branch. Open P2/P3
   findings are archived with the item, not carried into the wave.
3. In the integration worktree, squash-merges the feature branch. It may resolve
   only mechanical conflicts: build-plan ticks, and **additive** conflicts where
   both sides only added distinct lines (keep both). Any other conflict aborts
   the merge and returns the item to its implementer to merge the integration
   tip into the feature branch; the item then repeats Step 6 in full.
4. Commits the squash as one conventional commit (one parent: the previous
   integration tip), runs Verify in the integration worktree, and on failure
   resets that one commit (`git reset --hard HEAD~1`) and returns the item for
   repair.
5. Confirms the new tip contains the item's archive unchanged, then removes the
   feature worktree and deletes its branch with `git branch -D`.

After each landing, update the wave record, recompute the frontier from the
integration worktree, and start newly unblocked items while capacity allows:
they go through Steps 2–6, forked from the new integration tip, with their own
spec approval packet.

## Step 8 - integration review

When nothing is in flight or queued:

1. Run Verify in the integration worktree.
2. When `avengers.finalIntegrationAudit` is true, start a **reviewer-lens**
   subagent to audit the combined diff from the recorded starting commit to the
   integration tip, focused on cross-feature contracts, integration seams,
   security boundaries and regression risk, recording findings in the
   integration worktree's ledger. Then start a **merger** to commit that ledger
   to the integration branch, so nothing is lost when worktrees are removed.
3. Repair a confirmed P0 or P1 like `/continuous` step 3: a fix branch forked
   from the integration tip, built and reviewed like an item, squash-merged by
   the merger, then re-audited.
4. Run `/check` behavior once on the integrated app when any item's done-whens
   needed runtime evidence.

## Step 9 - stop for the user

Set activity to `ready` and present the wave report. Then ask how to land,
following `git.landing`:

- `local-merge`: after a yes, fast-forward the default branch to the integration
  branch from the main checkout (`git merge --ff-only <prefix><n>`), keeping one
  commit per feature.
- `pull-request`: after a yes, push the integration branch and open one pull
  request whose body follows `mp-pr`. Merge it without squashing so each
  feature keeps its own commit and archive proof.

After landing, remove the integration worktree and, once merged, its branch.
Delete the wave record and set activity to `completed`.

## Resume

`/avengers resume` reads `blueprint/.state/avengers.json`, then trusts Git over
the record: confirm every listed branch and worktree exists, each spec's checked
steps, each receipt's target commit, and the integration branch's landed
commits. Continue each item from its first incomplete step. Anything the record
claims but Git does not show is redone, never assumed. A dropped item resumes
from Step 4 once its decision is answered.

## Stops

Stop the whole run, preserving every worktree, branch and commit, for: invalid
config or state, a dirty or drifted main checkout, movement of the default
branch since the wave started, a hook block, an unavailable subagent runtime, or
a decision only the user can make that blocks every remaining item. A problem
with one item blocks only that item.

## Report

Readable without the progress updates:

- starting default-branch commit, integration branch and tip
- per item: branch, models used per role (requested and actual), gates run with
  results, findings by axis and severity, repairs, landing commit or block reason
- dropped and deferred items and why, with the exact question for each decision
- integration audit and check results
- build-plan progress and the next frontier
- the exact landing choice awaiting your yes, and a reminder that nothing was pushed

## Rules

- Never two mergers at once; only the merger writes the integration branch.
- One worktree, one branch, one spec per item; never two items in one checkout.
- Subagents get file pointers, not pasted context.
- Gates never weaken: Verify, configured checks, fresh review and P0/P1 blocking
  apply to every item exactly as in `/continuous`.
- Stop truthfully. A blocked item with a precise reason beats a fabricated pass.

## Formatting

Follow `blueprint/context/ai-interaction.md`. Keep progress updates to one line
per item state change.
