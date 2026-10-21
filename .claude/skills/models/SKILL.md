---
name: models
description: Show and change the model and effort for the main agent and each subagent role (planner, implementer, merger, explorer, reviewers), for the team or just you, and check subagents ran on the requested models. Use for /models or agent model settings.
disable-model-invocation: true
---

# models - choose the model for every role

**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.

Where this sits in the workflow:

    /onboard  ->  [models]  ->  /avengers, /continuous, /autopilot, /audit independent
                  (team or      (each subagent call passes the resolved
                   personal)     model and effort)

This skill reads and writes model settings only. It never edits code, specs or
other configuration, and never commits.

Read `reference/resolution.md` first; it is the contract for roles, precedence
and valid values.

## Input

- `/models` - show the effective settings and offer changes.
- `/models check` - compare requested and actual models in recent review receipts
  and the active wave record. Read-only.
- `/models set <role> <model> [effort]` - change one role directly; ask whether to
  write the team file or your personal file.

## Show

Read `blueprint/config.json`, `blueprint/config.local.json` when present, the
`model` and `effort` fields of `.claude/agents/*.md`, and the session's current
main model when the runtime exposes it. Present one table:

| Role | Model | Effort | Comes from |
| --- | --- | --- | --- |

"Comes from" names the winning layer (personal file, team file, subagent default,
agent file, inherit). Below it, flag:

- invalid values;
- `reviewerMustDiffer` conflicts;
- aliases in team config (suggest full IDs);
- a main-model setting that differs from the session's current model.

## Change

Ask in at most three questions, recommending the current team value first:

1. **Main agent** model.
2. **Builders**: implementer and merger (and explorer).
3. **Reviewers and planner**: planner, lens, standards, spec, with effort.

Then ask where to save: **team** (`blueprint/config.json`, committed with the
project) or **personal** (`blueprint/config.local.json`, Git-ignored). Make sure
`blueprint/config.local.json` is listed in `.gitignore` before writing it; add
the line when missing, after saying so.

Edit only the `models` object. Keep every other key and the file's formatting.
Validate the result against `reference/resolution.md` before writing.

## The main agent

A skill cannot switch the running session's model. After saving `models.main`:

- **Personal:** offer to write `"model": "<value>"` to `.claude/settings.local.json`
  so new sessions start on it.
- **Team:** offer to write it to `.claude/settings.json`. Project settings
  reapply at every launch and outrank each developer's own default, so mention
  that before writing.
- Either way, tell the user to run `/model <value>` to switch this session now, or
  to start sessions with `claude --agent avengers-lead`, whose definition uses the
  team's main model.

Never edit a settings file without a yes in the current chat.

## Check

`/models check` reads `blueprint/context/review.md` receipts, archived receipts
in the latest `blueprint/history/` entries, and `blueprint/.state/avengers.json`.
For each role, report requested versus actual model. Name the likely cause of
any mismatch: an `availableModels` allowlist, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`,
a per-run override, or a tool without per-role control.

## Rules

- Model settings never weaken a gate, never skip review and never change
  approval boundaries.
- The `restricted` profile may only use the models the client approved; when
  `profile` is `restricted`, ask for confirmation before saving any change.
- Report what was saved and where, in one short table.

## Formatting

Follow `blueprint/context/ai-interaction.md`.
