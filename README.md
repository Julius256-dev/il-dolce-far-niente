# Il Dolce Far Niente

**Build several features at once with AI agents, without giving up review.**

Il Dolce Far Niente is an installable set of agent skills for teams that build
real software with Claude Code (and Codex, Copilot, Antigravity or OpenCode).
It combines:

- **[AI Blueprint](https://ai-blueprint.dev/)**'s file-backed, gated feature loop:
  spec → small verified steps → proof → fresh-context review → archive.
- **`/avengers`**: build every unblocked build-plan item in parallel, each in its
  own Git worktree with its own planner, implementer and reviewers, then land them
  one at a time on an integration branch that only you merge.
- **[Matt Pocock's skills](https://github.com/mattpocock/skills)** for the
  engineering practice Blueprint doesn't cover: two-axis code review, TDD,
  triage, wayfinding, architecture surveys and retros.
- **Per-role models**: Opus 5.5 plans and reviews, Sonnet 5.5 builds, by default.
  Change any role for the team or just for you with `/models`.

Nothing in it pushes, publishes or deploys on its own. Subagents run behind a hook
that blocks pushes and any change to your default branch.

## Install

Scaffold your app first (any stack), make it a Git repository, then from its root:

```bash
npx il-dolce-far-niente@latest
```

Then, in your agent:

1. `/onboard` - tune commands and standards, pick a profile (`client-delivery`,
   `product` or `restricted`), your issue tracker, and models.
2. Write `blueprint/project-plan.md` and `blueprint/build-plan.md` (or run
   `/discovery`), then `/overview`.
3. `/plan-graph` - mark which build-plan items depend on which.
4. `/avengers` - build the unblocked ones in parallel. Or `/feature` for one at a time.

Update later with `npx il-dolce-far-niente@latest update`. Files you edited
locally are never overwritten silently.

Claude Code users can also install the helper plugin, which runs the installer
and updates from inside a session:

```bash
claude plugin marketplace add Julius256-dev/il-dolce-far-niente
claude plugin install il-dolce-far-niente@julius256-dev
```

## How `/avengers` works

1. Reads the build plan's dependency suffixes (`_(after: 2, 3)_`) and picks the
   **frontier**: items whose blockers are done. Items that would touch the same
   files, or both touch auth, payments, migrations or shared config, are split
   into later waves.
2. A **planner** writes each spec in its own worktree. You approve them in one
   packet.
3. An **implementer** builds each spec test-first; Verify runs after every step.
4. Fresh **reviewers** check each item: Blueprint's quality, security,
   performance and tests lens, plus Matt Pocock's standards and spec axes. P0/P1
   findings block landing; repairs are re-reviewed in full.
5. A landing script archives each passing item exactly like `/complete` and
   squash-merges it onto `wave/<n>`, one at a time. A **merger** agent steps in
   only when a landing conflicts.
6. An integration audit checks the combined wave. You choose how it lands: local
   merge or pull request.

### Keeping usage low

The orchestrator is a coordinator: `avengers.mjs` and `land.mjs` do the
bookkeeping and the `/complete` archive steps in one call each, agents start
without `AGENTS.md` and read only their role's files, and the merger runs only
when a landing conflicts. On a measured 4-item wave this cut orchestrator spend
by 41% and the whole wave by 28%, with every gate still in place. See
[docs/DESIGN.md](docs/DESIGN.md#keeping-usage-low).

## Commands

| Command | What it does |
| --- | --- |
| **/onboard** | Tune a fresh project: commands, standards, profile, tracker, models, adapters |
| **/adopt** | Bring the workflow into an existing codebase with shipped features |
| **/discovery** | Guided planning interview that drafts the two plan files |
| **/overview** | Turn the plans into `project-overview.md` |
| **/plan-graph** | Add dependency edges to the build plan and show the parallel frontier |
| **/models** | Show or change the model and effort for every role; check what actually ran |
| **/avengers** | Build the frontier in parallel worktrees and land it one item at a time |
| **/brief** | Preview a planned feature: scope, dependencies, size |
| **/feature** | Write the spec for one build-plan feature |
| **/fix** | Write a spec for a bug or small unplanned change |
| **/implement** | Build the approved spec in small verified steps |
| **/check** | Prove the spec's done-whens against the running app, or write a Try It Now guide |
| **/audit** | Review code for quality, security, performance or tests; run independent review |
| **/complete** | Final gates, archive, and land locally or by pull request |
| **/autopilot** | One bounded spec-and-build pass through the gates, stopping before landing |
| **/continuous** | Build the remaining plan serially, one feature at a time |
| **/status** | Progress, the frontier, an active wave, and the next action |
| **/explore** | Investigate an idea against the code without changing files |
| **/debug** | Reproduce and isolate a failure without editing code |
| **/doctor** | Health check for setup, adapters, plans and drift |
| **/prototype** | Throwaway static mockups to lock the look before building |
| **/tests** | Set up unit or browser tests |
| **/ci** | One Verify command, run locally and in GitHub Actions |
| **/rollback** | Plan a safe reversal of a completed feature |
| **/release** | Deployment readiness for Render or Vercel |
| **/mp-triage** | Move issues through triage and hand accepted work to `/fix` or the plan |
| **/mp-wayfinder** | Map a large, foggy effort as decision tickets until the route is clear |
| **/mp-architecture** | Survey the codebase for deepening opportunities |
| **/mp-retro** | Suggest improvements to standards, checks and agent instructions |
| **/mp-grill** | Alignment interview that also updates the glossary and ADRs |
| **/mp-tdd** | Red-green TDD at the spec's agreed seams (loaded by `/implement`) |
| **/mp-code-review** | Standards and spec review of a diff (loaded by reviewers) |
| **/mp-grilling** | The interview primitive behind planning skills |
| **/mp-domain-modeling** | Sharpen domain terms, `GLOSSARY.md` and ADRs |
| **/mp-codebase-design** | Vocabulary for deep modules, seams and interfaces |
| **/mp-diagnosing-bugs** | Reproduce, minimise, hypothesise, instrument (loaded by `/debug`) |
| **/mp-research** | Cited research notes in `blueprint/research/` |
| **/mp-pr** | Pull request body format used when landing by pull request |
| **/mp-writing-for-agents** | How to write skills and agent instructions |

In Codex use `$name` instead of `/name`.

## Models

| Role | Default |
| --- | --- |
| Main agent | Opus 5.5 (`claude-opus-5-5`) |
| Planner, lens / standards / spec reviewers | Opus 5.5, medium effort |
| Implementer, merger (conflicts only), explorer | Sonnet 5.5 (`claude-sonnet-5-5`) |

Team defaults live in `blueprint/config.json` under `models`; personal overrides
in the Git-ignored `blueprint/config.local.json`. Orchestrators pass each role's
model on every subagent call. A session's own model is set with `/model`, or by
starting with `claude --agent avengers-lead`.

## Staying current with upstream

The repo keeps pristine copies of AI Blueprint and Matt Pocock's skills under
`upstream/` (via `git subtree`). A weekly workflow pulls new upstream commits and
three-way merges them into our copies (`npm run sync:upstream`), then opens a
pull request. Our additions sit between `<!-- ext:begin -->` markers so they
rarely conflict. See [docs/DESIGN.md](docs/DESIGN.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## Credits and licence

MIT. Built on [AI Blueprint](https://github.com/aiblueprinthq/ai-blueprint) by
Brad Traversy and [skills](https://github.com/mattpocock/skills) by Matt Pocock,
both MIT; their notices are in [LICENSES/](LICENSES/) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Not affiliated with either
project.
