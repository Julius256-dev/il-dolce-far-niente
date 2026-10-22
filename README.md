<p align="center"><img src="plugin/.claude-plugin/icon.png" alt="" width="96" height="96"></p>

<h1 align="center">Il Dolce Far Niente</h1>

<p align="center"><strong>Let AI agents build several features at once. You approve the plans and the landing.</strong></p>

<p align="center">
  <a href="https://julius256-dev.github.io/il-dolce-far-niente/">Website</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="#all-commands">Commands</a> ·
  <a href="https://www.npmjs.com/package/il-dolce-far-niente"><img src="https://img.shields.io/npm/v/il-dolce-far-niente" alt="npm version" align="center"></a>
</p>

Il Dolce Far Niente is a set of skills for AI coding agents (Claude Code, Codex,
GitHub Copilot, OpenCode, Antigravity). It gives every feature the same careful
loop: a written spec you approve, small tested steps, proof that it works, a
review by a fresh agent, and an archive. With `/avengers` it runs that loop for
several features in parallel, each in its own Git worktree, and lands them one
at a time on a branch that only you merge.

It never pushes, publishes or deploys on its own.

> **The name.** *Il dolce far niente* (Italian, said "eel DOHL-chay far
> NYEN-tay") means "the sweetness of doing nothing": unhurried, guilt-free
> idleness, enjoyed because the work is in good hands. Word for word: *il*
> (the), *dolce* (sweet), *far* (doing), *niente* (nothing). Here the agents
> plan, build and review; you keep every decision.

## Get started

You need an app in a Git repository (any stack, scaffold it first) and Node.js 22+.

1. **Install**, from the root of your app:

   ```bash
   npx il-dolce-far-niente@latest
   ```

2. **Onboard.** Restart your agent and run `/onboard`. For an app that already has
   features, run `/adopt` instead.
3. **Plan.** Describe the project in `blueprint/project-plan.md` and list features
   in `blueprint/build-plan.md` (or run `/discovery` to be interviewed), then run
   `/overview`.
4. **Add checks.** Run `/ci` once to get one Verify command (typecheck, tests,
   build) that every change must pass.
5. **Build.**
   - One feature: `/feature` → `/implement` → `/check` → `/complete`.
   - Several at once: `/plan-graph` to mark what depends on what, then `/avengers`.

In Codex, type `$feature` instead of `/feature`.

## Install for your tool

All routes install the same version into your repo. The plugins add one
`install` skill: ask your agent to "install Il Dolce Far Niente" and approve the
command it shows.

| You use | Install |
| --- | --- |
| Any agent | `npx il-dolce-far-niente@latest` |
| Claude Code | `claude plugin marketplace add Julius256-dev/il-dolce-far-niente`<br>`claude plugin install il-dolce-far-niente@julius256-dev` |
| Codex | `codex plugin marketplace add Julius256-dev/il-dolce-far-niente`<br>`codex plugin add il-dolce-far-niente@julius256-dev` |
| GitHub Copilot CLI | `copilot plugin marketplace add Julius256-dev/il-dolce-far-niente`<br>`copilot plugin install il-dolce-far-niente@julius256-dev` |
| Cursor, OpenCode, Windsurf | `npx skills@latest add Julius256-dev/il-dolce-far-niente` |

**Update** with `npx il-dolce-far-niente@latest update`. Files you changed
locally are never overwritten without asking.

## How a parallel build works

1. **Pick what can start.** Build-plan items say what they wait for, like
   `_(after: 2, 3)_`. Items that touch the same files, or both touch payments or
   SMS, go in different waves.
2. **Plan each feature.** A planner writes each spec in its own worktree. You
   approve them all in one packet.
3. **Build in parallel.** Builders work test-first, one small verified step at a
   time.
4. **Review fresh.** Reviewers who never saw the build check the coding
   standards and the spec, plus security and quality when the work is sensitive.
   Serious findings block landing until a re-review closes them.
5. **Land one at a time.** Each feature is archived and squashed onto
   `wave/<n>`, and Verify runs again after every landing.
6. **You merge.** A final review covers the whole wave, then it waits for your yes.

## Built for real client work

- **Payments and SMS are always sensitive.** PesaPal, Flutterwave, escrow,
  payouts and Africa's Talking (including webhooks) always get an audit and an
  independent review, and two of them never share a wave.
- **Restricted code.** For classified or regulated work, get the client's
  written answer on whether code may leave the premises before any agent runs.
  See [docs/RESTRICTED.md](docs/RESTRICTED.md).
- **Web and mobile.** Verify recipes for Next.js (pnpm), Expo and Flutter, and a
  mobile check that uses widget tests plus a simulator screenshot.
- **Team habits.** Conventional commits, no AI attribution, consistent branch
  names, a retro after every wave and a weekly architecture review.
- **A model for every role.** By default Opus 5.5 plans and reviews and Sonnet
  5.5 builds. Change any role for the team or just for you with `/models`.

## All commands

<details>
<summary>Show all 39 commands</summary>

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

</details>

## Configuration

Team settings live in `blueprint/config.json` (profile, review gates, tracker,
parallel limits, sensitive categories, models). Personal model overrides go in
the Git-ignored `blueprint/config.local.json`. `/onboard` sets the common ones;
[docs/DESIGN.md](docs/DESIGN.md) lists every key.

| Role | Default model |
| --- | --- |
| Main agent | Opus 5.5 |
| Planner and the three reviewers | Opus 5.5, medium effort |
| Implementer, merger (conflicts only), explorer | Sonnet 5.5 |

## Contributing and upstream updates

The repo keeps pristine copies of AI Blueprint and Matt Pocock's skills under
`upstream/`. A weekly workflow merges their updates in and opens a pull request.
See [CONTRIBUTING.md](CONTRIBUTING.md) to develop, test and release.

## Credits and licence

MIT. Built on [AI Blueprint](https://github.com/aiblueprinthq/ai-blueprint) by
Brad Traversy and [skills](https://github.com/mattpocock/skills) by Matt Pocock,
both MIT; their notices are in [LICENSES/](LICENSES/) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Not affiliated with either
project.
