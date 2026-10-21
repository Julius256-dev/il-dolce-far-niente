# il-dolce-far-niente

Il Dolce Far Niente installs a file-backed, gated AI development workflow into an
app you have already scaffolded. It is a fork of
[AI Blueprint](https://ai-blueprint.dev)'s installer and keeps Blueprint's loop:
plan, spec, build, verify and document one feature at a time, with human review
gates before code changes and merges.

On top of that loop it adds:

- **`/avengers`**: build several build-plan features at once, each in its own
  Git worktree, then land them one at a time onto an integration branch.
- **`/plan-graph`**: record dependency edges between build-plan items so
  independent features can run in parallel.
- **`/models`**: choose the model for the main session and for each subagent
  role (planner, implementer, merger, reviewers, explorer).
- **Matt Pocock's engineering skills** (`mp-*`), such as TDD, domain modeling,
  code review, bug diagnosis and triage, wired into Blueprint's files.

[Repository](https://github.com/Julius256-dev/il-dolce-far-niente) |
[Issues](https://github.com/Julius256-dev/il-dolce-far-niente/issues)

## Install

Requires Node.js 22 or newer. Run the installer from the root of an application
that has already been scaffolded and initialized as a Git repository:

```bash
# npm
npx il-dolce-far-niente@latest

# pnpm
pnpm dlx il-dolce-far-niente@latest
```

Do not run a framework scaffolder (create-next-app, Vite and so on) after
installing; scaffold the app first, then install.

The installer copies these into the project and leaves your `README.md` alone:

- `AGENTS.md` and `CLAUDE.md`
- `blueprint/` (config, plans, context and history)
- `.agents/skills/` for Codex, GitHub Copilot, Google Antigravity and OpenCode
- `.claude/skills/`, `.claude/agents/` and `.claude/hooks/` for Claude Code
- `blueprint/.state/manifest.json`, which records the managed files for updates

Then open the project in your AI tool and run `/onboard` (Claude Code, Google
Antigravity) or `$onboard` (Codex).

## Choosing adapters

Interactive installs ask which AI tools to set up. Non-interactive installs
(`--yes` or no TTY) install every adapter. Pick them explicitly with flags:

```bash
npx il-dolce-far-niente@latest -- --claude
npx il-dolce-far-niente@latest -- --codex --opencode
npx il-dolce-far-niente@latest -- --all
```

| Flag | Tool | Files |
| --- | --- | --- |
| `--claude` | Claude Code | `CLAUDE.md`, `.claude/skills/`, `.claude/agents/`, `.claude/hooks/` |
| `--codex` | Codex | `.agents/skills/` |
| `--copilot` | GitHub Copilot | `.agents/skills/` |
| `--antigravity` | Google Antigravity | `.agents/skills/` |
| `--opencode` | OpenCode | `.claude/skills/` when Claude Code is selected, otherwise `.agents/skills/` |

The parallel `/avengers` subagent roles and the hook that blocks remote Git
operations ship with the Claude Code adapter.

Other options: `--target <dir>`, `--dry-run`, `--force`, `--yes`. Run
`npx il-dolce-far-niente@latest --help` for the full list.

## Update

```bash
npx il-dolce-far-niente@latest update
```

Updates replace only managed skill, agent and hook files and preserve your
plans, context, history, configuration, `AGENTS.md` and `CLAUDE.md`. Files you
edited locally are reported as conflicts; the update stops unless you confirm
replacement interactively or pass `--force`, which backs them up under
`blueprint/.state/backups/` first.

```bash
npx il-dolce-far-niente@latest update --dry-run
npx il-dolce-far-niente@latest update --codex       # add an adapter
npx il-dolce-far-niente@latest update --target ./my-app --yes
```

Adapter flags add to the installed set. To remove an adapter, run the update
interactively without adapter flags and deselect it.

## Status and dashboard

```bash
npx il-dolce-far-niente@latest status
npx il-dolce-far-niente@latest status --json
npx il-dolce-far-niente@latest dashboard
```

After an interactive install, the installer can also add the optional global
`blueprint` command, which gives the shorter `blueprint status` and
`blueprint dashboard`. The global command never installs or updates projects.

## Configuration

`blueprint/config.json` holds Blueprint's workflow settings plus these optional
keys; a missing key uses its default:

- `profile`: `client-delivery`, `product`, `restricted` or `custom` (default).
- `tracker`: issue tracker `kind` (`local`, `github`, `gitlab`), its `doc`, and
  `labels` for the seven canonical triage roles.
- `domainDocs`: paths of the domain `glossary` and the `adr` folder.
- `avengers`: `maxConcurrent` (1-8; 1 disables parallel builds),
  `specApproval` (`batch` or `each`), `integrationBranchPrefix`,
  `worktreeRoot`, `serializeWhen`, `finalIntegrationAudit` and `portBase`.
- `models`: `main`, `subagentDefault`, per-role `roles` and `effort`, and
  `reviewerMustDiffer`. Model values are `inherit`, an alias (`fable`, `opus`,
  `sonnet`, `haiku`, `best`, `opusplan`, optionally with `[1m]`) or a full
  `claude-*` model ID.

Configuration can make review stricter. It never grants permission to push,
merge to the default branch, deploy or publish.

## Credits

- [AI Blueprint](https://ai-blueprint.dev) by Brad Traversy
  ([aiblueprinthq/ai-blueprint](https://github.com/aiblueprinthq/ai-blueprint)),
  MIT. The installer, `blueprint` CLI, dashboard and the core workflow skills
  come from AI Blueprint.
- [Matt Pocock's skills](https://github.com/mattpocock/skills), MIT. Each
  adapted skill carries an `UPSTREAM.md` naming its source.

## License

MIT. See [LICENSE](LICENSE).
