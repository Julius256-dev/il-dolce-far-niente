# Changelog

## 0.1.0 - unreleased

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
