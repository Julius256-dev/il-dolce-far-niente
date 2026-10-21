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

Upstream: AI Blueprint 1.13.0 (`a314613`), mattpocock/skills 1.3.1 (`5beb35b`).
