# Model resolution

How every orchestrator decides which model and effort a role runs on. `/models`,
`/avengers`, `/autopilot`, `/continuous` and independent review all use this
exact order, so the same configuration always gives the same answer.

## Roles

| Role | Used by |
| --- | --- |
| `main` | the session you talk to (applied with `/model`, not per call) |
| `planner` | spec drafting in `/avengers` |
| `implementer` | building and repairs |
| `merger` | landing features on the integration branch |
| `reviewer-lens` | Blueprint independent review (Phase B) |
| `reviewer-standards` | Standards axis (`mp-code-review`) |
| `reviewer-spec` | Spec axis (`mp-code-review`) |
| `explorer` | research and code mapping |

## Order, highest first

For a subagent role `R`:

1. A per-run override given to the command (for example
   `/avengers --implementer claude-sonnet-5-5`).
2. `models.roles.R` in `blueprint/config.local.json` (personal, Git-ignored).
3. `models.roles.R` in `blueprint/config.json` (team).
4. `models.subagentDefault` (local file first, then team file).
5. The `model` field in `.claude/agents/R.md`.
6. `inherit` (the main session's model).

Effort follows the same order using `models.effort.R`; with no value anywhere,
pass no effort and let the runtime default apply. The `--effort-reviewers` option
sets all three reviewer roles.

## Valid values

- `inherit`
- an alias: `fable`, `opus`, `sonnet`, `haiku`, `best`, `opusplan`, optionally
  followed by `[1m]`
- a full model ID matching `^claude-[a-z0-9-]+$`, for example `claude-opus-5-5`

Prefer full IDs in team config: aliases resolve to different versions on some
providers and change when new models ship. An invalid value stops the command
and points to `/models`.

## Applying it

- **Claude Code:** pass the resolved model as the subagent call's `model`
  parameter and the effort as its `effort` parameter. The per-call value outranks
  the agent file and `CLAUDE_CODE_SUBAGENT_MODEL`. When the runtime's `model`
  parameter accepts only family names, pass the family of the resolved model
  (`claude-opus-5-5` → `opus`, `claude-sonnet-5-5` → `sonnet`,
  `claude-haiku-*` → `haiku`, `claude-fable-*` → `fable`) and confirm the exact
  model the subagent reports; a family name resolves to that family's current
  version, which may differ from a pinned ID.
- **Things that can override you silently:** an administrator's
  `availableModels` allowlist swaps a blocked model for a permitted one, and
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` makes every subagent use one model. Always
  record the requested model, read the actual model from the subagent's result
  or receipt when the runtime exposes it, and report any difference.
- **Other tools (Codex, Copilot, Antigravity, OpenCode):** record the requested
  model, run with what the tool provides, and report the actual model. Per-role
  control depends on that tool's own settings.

## Reviewer independence

When `models.reviewerMustDiffer` is true, compare each reviewer role's resolved
model with the implementer's. If they match, warn before the run and offer the
next stronger alternative. Reviewers stay independent in every case because they
start with no builder transcript.
