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

## Compute it with the script

Orchestrators and `/models` MUST get the resolution by running the resolver,
never by working through the layers below by hand. From the project root, run
the first of these that exists:

```text
node .claude/skills/models/scripts/resolve.mjs [options]
node .agents/skills/models/scripts/resolve.mjs [options]
```

Options: a per-run override per role (`--planner`, `--implementer`, `--merger`,
`--explorer`, `--reviewer-lens`, `--reviewer-standards`, `--reviewer-spec`, each
followed by a model), `--reviewers <model>` for all three reviewer roles,
`--effort-<role> <level>` and `--effort-reviewers <level>`, `--main <model>`,
`--role <name>` to print one role, and `--text` for a table. Pass the command's
own per-run overrides through these flags.

It prints JSON:

```json
{
  "main": { "model": "claude-opus-5-5", "family": "opus", "source": "team" },
  "roles": {
    "planner": {
      "model": "claude-opus-5-5",
      "family": "opus",
      "effort": "medium",
      "source": "team",
      "effortSource": "team"
    }
  },
  "warnings": []
}
```

- `model` - the value to pass as the subagent call's `model`.
- `family` - what to pass instead when the runtime accepts only family names
  (`opus`, `sonnet`, `haiku`, `fable`; aliases, `inherit`, `best` and `opusplan`
  map to themselves; `null` for an ID with no known family).
- `effort` - the effort to pass, or `null` to pass none.
- `source` - the winning layer for the model: `override`, `local`, `team`,
  `subagentDefault`, `agent-file` or `inherit` (`main` uses `override`, `local`,
  `team` or `default`). `effortSource` is the same for effort, or `none`.
- `warnings` - `reviewerMustDiffer` conflicts, aliases in team config, and keys
  the personal file may not set (those are ignored). Show every warning before
  the run.

An invalid value anywhere exits with status 1 and a message on stderr: stop and
point to `/models`. If neither script exists, say so and stop rather than
guessing.

## Order, highest first

For a subagent role `R`:

1. A per-run override given to the command (for example
   `/avengers --implementer claude-sonnet-5-5`).
2. `models.roles.R` in `blueprint/config.local.json` (personal, Git-ignored).
3. `models.roles.R` in `blueprint/config.json` (team).
4. `models.subagentDefault` (local file first, then team file).
5. The `model` field in `.claude/agents/R.md`.
6. `inherit` (the main session's model).

Effort follows the same order using `models.effort.R` (there is no effort
`subagentDefault`); with no value anywhere, pass no effort and let the runtime
default apply. An empty `"effort": {}` sets no effort for any role. The
`--effort-reviewers` option sets all three reviewer roles. A role missing from
`models.roles` falls through to the next layer; the parser never fills it in.

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

When `models.reviewerMustDiffer` is true (the default; the personal file's value
wins), the resolver compares each reviewer role's resolved model with the
implementer's, treating `inherit` as the main model. If they match, warn before the run and offer the
next stronger alternative. Reviewers stay independent in every case because they
start with no builder transcript.
