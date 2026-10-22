# Changelog

## Unreleased

- A website at https://julius256-dev.github.io/il-dolce-far-niente/, published
  from `site/` by the Website workflow.
- A shorter README built around a five-step quick start, with what the name
  means.
- A new identity and website: a simple mark (three lanes merging into one),
  a clean landing page modelled on AI Blueprint's structure with a live wave
  diagram, an animated install terminal and a word-by-word gloss of the name.
  Fonts are self-hosted (Geist and Geist Mono, SIL OFL).

## 0.3.0 - unreleased

The first published version. It includes everything listed under 0.1.0 below,
which was never published on its own.

- **Shipping:** one version across npm, the Claude Code, Codex and Copilot
  plugins and skills.sh (`scripts/release-version.ts`), a release
  workflow that publishes to npm with provenance when a new version reaches `main`, a Codex marketplace
  (`.agents/plugins/marketplace.json`) and portable `plugin/plugin.json`, and a
  skills.sh listing that offers only the `install` skill (workflow skills are
  `metadata.internal`). Two skill descriptions (`check`, `plan-graph`) were not
  valid strict YAML, so Codex, Copilot and skills.sh skipped them; they are
  quoted now and the validator rejects the pattern.

- **Payments and SMS are always sensitive.** PesaPal, Flutterwave, escrow,
  payouts, mobile money, Africa's Talking and their webhooks trigger audit and
  independent review under `when-sensitive`. New `sensitive.patterns` config
  adds project categories. `/avengers` detects them from plan lines, specs and
  diffs, turns on the lens review, and never builds two payment or two SMS items
  in the same wave (`sms` joins `serializeWhen`).
- **Verify recipes per stack** in `/ci`: Next.js/TypeScript with pnpm,
  Expo/React Native, Flutter, and mixed repositories.
- **Mobile check recipe** in `/check`: component or widget tests, then a
  simulator screenshot, Flutter golden or Expo web screenshot, so the check gate
  finishes on Expo and Flutter features.
- **Restricted repositories:** a written-confirmation process
  (`skills/onboard/reference/restricted.md`), `dataHandling` and `research.web`
  config, and `.claude/hooks/data-handling.mjs`, which refuses prompts until the
  answer is recorded, refuses cloud endpoints when code may not leave the
  premises, and blocks web research when it is off.
- **Team cadence:** `/mp-retro` after every wave and `/mp-architecture` weekly
  now write `blueprint/research/` notes and route accepted items to the
  findings ledger or the build plan; `/onboard` offers the weekly schedule.
- **Team conventions** open the coding-standards template: Conventional
  Commits, no AI attribution, branch prefixes, pnpm over Bun. Expo and Flutter
  standards are starting points for `/onboard`.

## 0.1.0 - not published separately (ships in 0.3.0)

First release.

- `/avengers`: build the build plan's frontier in parallel, one worktree per item,
  with planner, implementer, merger and fresh reviewer subagents, landing items
  one at a time on an integration branch.
- `/plan-graph`: dependency edges in the build plan (`_(after: n)_`).
- `/models`: per-role model and effort, team and personal, with a check that
  compares requested and actual models.
- 15 adapted Matt Pocock skills (`mp-*`), wired into Blueprint's findings ledger,
  tracker and plan files.
- Profiles for `client-delivery`, `product` and `restricted` work.
- Subagent definitions and a hook that blocks pushes, publishes, deploys and
  default-branch changes from every subagent.
- Installer `il-dolce-far-niente`, forked from `create-ai-blueprint` 1.13.0.
- Upstream sync: pinned subtrees, three-way merge script and weekly workflow.
- Lean `/avengers`: `avengers.mjs` does the wave bookkeeping (preflight, setup,
  state, Verify, review checkpoints, recording reviewer output, gates, status)
  in one call per job; `land.mjs` performs `/complete` Steps 0–2 and the squash
  onto the wave, resolving build-plan ticks, findings ledgers and the overview
  fingerprint itself, so the merger agent only handles conflicts. The
  orchestrator no longer loads `/continuous`, `/audit` or `/complete`, and every
  subagent starts without `AGENTS.md` (`omitClaudeMd`) and reads only its role's
  files. `land.mjs` also keeps both sides of insert-only conflicts (an index of
  re-exports, a route list), so those need no merger or re-review.
- Open, fixed and unverified findings now stay in the live ledger when a wave
  item lands, matching `/complete`; they travel with the squash and keep their
  IDs unless the wave ledger already uses one.

Upstream: AI Blueprint 1.13.0 (`a314613`), mattpocock/skills 1.3.1 (`5beb35b`).
