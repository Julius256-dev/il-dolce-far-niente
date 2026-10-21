# Third-party notices

Il Dolce Far Niente includes adapted copies of the projects below. Each keeps
its own licence; full texts are in `LICENSES/`. Pinned upstream commits are
recorded in `upstream.lock.json` and updated by `scripts/sync-upstream.ts`.

| Project | Licence | Copyright | What we use | Where it lives here |
| --- | --- | --- | --- | --- |
| [AI Blueprint](https://github.com/aiblueprinthq/ai-blueprint) | MIT | Brad Traversy | Workflow skills, project template, installer and dashboard | `skills/` (non-`mp-` skills), `blueprint/`, `AGENTS.md`, `CLAUDE.md`, `evals/`, `packages/il-dolce-far-niente/`, `scripts/blueprint/` |
| [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | Matt Pocock | 15 engineering and productivity skills | `skills/mp-*`, `skills/plan-graph`, `skills/onboard/reference/trackers` |

Every adapted Matt Pocock folder carries an `UPSTREAM.md` naming its source path.
Pristine upstream copies live under `upstream/`.
