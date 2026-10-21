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
    (edges in        (spec, build, prove, review       (local merge or PR,
     build plan)      each item in its own worktree;    after your yes)
                      land each onto wave/<n>)

`/avengers` runs Blueprint's full feature loop for several items at once. Only
the scheduling changes: every item still gets a spec, small verified steps, the
configured quality gates, fresh-context review, and a `/complete`-style archive.
Items land one at a time on an integration branch; the default branch moves only
when you approve the finished wave.

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
- create checkpoint and review-checkpoint commits on feature branches
- squash-merge finished features into the integration branch, delete merged
  feature branches, and remove their worktrees

It does not authorize: any commit, merge or reset on the default branch, push,
pull request, publish, deploy, remote changes, destructive data operations,
irreversible migrations against shared data, accepting findings, waiving failed
checks, or product decisions. Landing the wave needs a separate yes in the
current chat.

## Input

- `/avengers` - start a wave from the current frontier.
- `/avengers 3 5 7` - start a wave with exactly these items; each must be on the
  frontier.
- `/avengers resume` - continue the recorded wave (see "Resume").
- Options: `--max <n>` caps this wave below `avengers.maxConcurrent`;
  `--autopilot` replaces the spec-approval stop with self-review (like
  `/autopilot`); role overrides for this run only: `--planner`, `--implementer`,
  `--reviewers`, `--merger`, `--explorer <model>` and `--effort-reviewers <level>`.

## Step 1 - preflight once

Read `AGENTS.md`, `blueprint/config.json` (and `blueprint/config.local.json` when
present), `blueprint/build-plan.md`, `blueprint/context/project-overview.md`,
`blueprint/context/current-feature.md`, `blueprint/context/findings.md`, and the
Git state: branch, status, default branch, worktrees (`git worktree list`), recent log.

Start only when all hold, otherwise stop with the exact fix:

- The config is valid (invalid → `/doctor`). `avengers.maxConcurrent` of `1`
  means parallel builds are off for this project: stop and suggest `/continuous`.
- The main checkout is clean on the default branch and
  `blueprint/context/current-feature.md` is empty. `/avengers` never adopts or
  overwrites active single-feature work.
- No P0 or P1 finding is `open` or `fixed`.
- A `Verify` command is documented under Commands in `AGENTS.md`. Parallel
  merges cannot be proven safe without it: stop and point to `/ci`.
- The overview is current, as `/continuous` requires.
- The runtime can start **background subagents** with a per-call model and wait
  for them. In Claude Code use the project agents in `.claude/agents/`
  (`planner`, `implementer`, `merger`, `reviewer-lens`, `reviewer-standards`,
  `reviewer-spec`, `explorer`); if an agent type is missing, start a general
  subagent and tell it to read and follow `.claude/agents/<role>.md`. If the
  runtime cannot run subagents in parallel, stop and suggest `/continuous`,
  which builds the same queue serially.
- Models resolve without error using `../models/reference/resolution.md`. When
  `models.reviewerMustDiffer` is true and a reviewer role resolves to the
  implementer's model, warn and ask before continuing.

Record the starting default-branch commit; it bounds the integration audit and
the report. Publish activity with boundary `local-only`.

## Step 2 - choose the wave

Build the frontier from `blueprint/build-plan.md`:

- A leaf with `_(after: a, b)_` is unblocked when every named item is checked
  (a named parent waits for all of its leaves).
- `_(after: none)_` is always unblocked.
- A leaf with **no suffix** depends on every earlier unchecked leaf, so it is
  unblocked only when no unchecked leaf comes before it.
- An item in an active wave is never a candidate again.

Take frontier items in plan order up to the cap. For each candidate, apply the
read-only `/brief` behavior to predict its files and areas and whether it
touches auth, payments, personal data, migrations, shared config or another
sensitive category.

**Overlap check.** Two candidates conflict when their predicted files or areas
overlap, or when both fall in a category listed in `avengers.serializeWhen`
(`sensitive` covers every category `/continuous` treats as sensitive). Keep the
earlier item and defer the later one to a later wave; it stays on the frontier.
Show the user the chosen items, deferred items and why. A wave of one is fine.

## Step 3 - set up worktrees

Choose the next wave number from existing `<integrationBranchPrefix>*` branches.
Then:

1. `git branch <prefix><n> <default-branch>` and
   `git worktree add <worktreeRoot>/<repo>-wave-<n> <prefix><n>` for the
   integration branch.
2. For each item, derive the branch exactly as `/feature` does (configured
   feature prefix + kebab-case title, build-attempt suffix rules from
   `../feature/reference/build-history.md`), then
   `git worktree add -b <branch> <worktreeRoot>/<repo>-<slug> <prefix><n>`.
3. Give each item a slot and port: `PORT = avengers.portBase + slot`. Pass it to
   every subagent working in that worktree; any dev server or `/check` run there
   uses that port. Never edit committed env files to do this.
4. Install existing locked dependencies in each worktree when the project needs
   them to build or test.

Write the wave record to `blueprint/.state/avengers.json` using
`reference/wave-state.md`. Update it at every state change below.

## Step 4 - spec every item

Start one **planner** subagent per item, in the background, all at once. Each
task names: the worktree path, the build-plan item, the frozen branch name, and
the resolved planner model and effort. Planners write only
`blueprint/context/current-feature.md` in their own worktree.

When all planners report, present **one approval packet** (`avengers.specApproval:
"batch"`). For each item: goal, steps, files/areas, done-whens, test seams, and
any decision the planner could not make. The user can approve all, approve some,
request edits (relay them to that item's planner and re-present), or drop items.
With `"each"`, present and approve the specs one at a time. With `--autopilot`,
self-review each spec like `/continuous` step 2.1 instead of stopping.

Set activity to `ready` while waiting for approval. An item with an unanswered
product, data, auth, billing or visual decision is dropped from the wave and
reported; it stays unchecked in the plan.

After approval, repeat the overlap check with each spec's real
**Files / areas**. A newly found overlap defers the later item until the earlier
one lands.

## Step 5 - build in parallel

Start one **implementer** subagent per approved item, in the background. Each
task names: worktree, branch, integration branch, port, the resolved implementer
model, the Verify command, and `workflow.checkpointCommits`. Implementers build
the spec in small verified steps with `mp-tdd` at the spec's seams and, before
reporting done, merge the integration tip into their branch and rerun Verify.

Handle implementers as they finish; do not wait for the slowest one. A failed or
blocked implementer stops only its own item.

## Step 6 - prove and review each item

For each finished item, inside its worktree, in this order:

1. **Verify.** Rerun the documented Verify command yourself. Failure goes back to
   the implementer as a repair.
2. **Check.** Apply `qualityGates.continuous.check` as `/continuous` does; a
   required check runs `/check` behavior in that worktree on its port.
3. **Review checkpoint.** Set the spec status to `verified` and create the
   review-checkpoint commit `/continuous` describes (covered by this run's
   authority). Record the base (integration tip the branch last merged) and the
   target commit.
4. **Axis review, in parallel.** Start a **reviewer-standards** and a
   **reviewer-spec** subagent with the base and target commits. They return
   findings as ready ledger blocks and write nothing. These two axes always run
   in `/avengers`, because no human watches each build step.
5. **Record axis findings.** Append the returned blocks to that worktree's
   `blueprint/context/findings.md` with the next free IDs, keeping each
   `**Axis:**` line and naming the reviewer and model under **Found**. Record
   exactly what was returned; do not judge or edit it.
6. **Lens review.** When `qualityGates.continuous` selects audit or independent
   review for the item (as `/continuous` decides), prepare the request with
   `/audit independent current` Phase A in that worktree, then start one
   **reviewer-lens** subagent to perform Phase B. It writes the receipt and its
   own findings, and passes only when no P0/P1 is `open` or `fixed` — including
   the axis findings. When neither gate selects review, the item passes review
   when no axis finding is P0 or P1.
7. **Try guide.** Apply `qualityGates.continuous.tryGuide` as `/continuous` does.

**Repairs.** For a confirmed P0 or P1, or a failed Verify or Check, send the
implementer back with the finding IDs. It repairs within scope and marks them
`fixed`. Then repeat this step from 1 with a new checkpoint; reviewers review the
whole new delta, never only the old findings. After
`continuous.maxRepairAttempts` attempts on the same failure, mark the item
`blocked` and keep the rest of the wave going.

## Step 7 - land one at a time

Items whose review passed queue for landing in build-plan order. Start **one**
**merger** subagent at a time, never two. It works in the integration worktree,
merges the integration tip into the feature branch, reruns Verify, applies
`/complete`'s archive behavior (spec, resolved findings, receipt, try guide,
build-plan tick, live-evidence reset, `landing: local-merge`), squash-merges into
the integration branch with one conventional commit, reruns Verify there, then
removes the feature worktree and branch.

A product-code merge conflict stops that item: it returns to its implementer to
merge the new integration tip, then goes through Step 6 again.

After each landing, recompute the frontier. Newly unblocked items join the run
while capacity allows: they go through Steps 2–6, including their own spec
approval packet.

## Step 8 - integration review

When nothing is in flight or queued:

1. Run Verify in the integration worktree.
2. When `avengers.finalIntegrationAudit` is true, audit the combined diff from the
   recorded starting commit to the integration tip, focused on cross-feature
   contracts, integration seams, security boundaries and regression risk, and
   record findings in the integration worktree's ledger. Repair a confirmed P0
   or P1 like `/continuous` step 3, on a fix branch merged into the integration
   branch, then re-audit.
3. Run `/check` behavior once on the integrated app when any item's done-whens
   needed runtime evidence.

## Step 9 - stop for the user

Set activity to `ready` and present the wave report (below). Then ask how to
land, following `git.landing`:

- `local-merge`: after a yes, fast-forward the default branch to the integration
  branch (`git merge --ff-only`), keeping one commit per feature.
- `pull-request`: after a yes, push the integration branch and open one pull
  request whose body follows `mp-pr`.

After landing, remove the integration worktree and, once merged, its branch.
Set activity to `completed`.

## Resume

`/avengers resume` reads `blueprint/.state/avengers.json`, then trusts Git over
the record: confirm every listed branch and worktree exists, each spec's checked
steps, each receipt's target commit, and the integration branch's landed
commits. Continue each item from its first incomplete step. Anything the record
claims but Git does not show is redone, never assumed.

## Stops

Stop the whole run, preserving every worktree, branch and commit, for: invalid
config or state, dirty or drifted main checkout, a decision only the user can
make that blocks every remaining item, a hook block, an unavailable subagent
runtime, or default-branch movement since the wave started. A problem with one
item blocks only that item.

## Report

Readable without the progress updates:

- starting default-branch commit, integration branch and tip
- per item: branch, worktree, models used per role (requested and actual),
  gates run with results, findings by axis and severity, repairs, landing commit
  or block reason
- deferred items and why; newly unblocked items still waiting
- integration audit and check results
- build-plan progress and the next frontier
- the exact landing choice awaiting your yes, and a reminder that nothing was pushed

## Rules

- Never two mergers at once; only the merger writes the integration branch,
  build-plan checkboxes and `blueprint/history/`.
- One worktree, one branch, one spec per item; never two items in one checkout.
- Subagents get file pointers, not pasted context.
- Gates never weaken: Verify, configured checks, fresh review and P0/P1 blocking
  apply to every item exactly as in `/continuous`.
- Stop truthfully. A blocked item with a precise reason beats a fabricated pass.

## Formatting

Follow `blueprint/context/ai-interaction.md`. Keep progress updates to one line
per item state change.
