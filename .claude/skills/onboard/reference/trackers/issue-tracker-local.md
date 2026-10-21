# Issue tracker: Local Markdown

Reference for `/onboard`: when `tracker.kind` in `blueprint/config.json` is `local` (the default), `/onboard` writes this content to `blueprint/context/tracker.md`, the tracker doc the `mp-*` skills read. Skills also fall back to these conventions when that doc is missing.

Issues for this repo live as markdown files in `blueprint/tickets/`. Feature specs stay in Blueprint's `blueprint/context/current-feature.md`; the build plan stays in `blueprint/build-plan.md`.

## Conventions

- One effort per directory: `blueprint/tickets/<slug>/`
- Tickets are one file per ticket at `blueprint/tickets/<slug>/<NN>-<ticket-slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (role strings from `tracker.labels` in `blueprint/config.json`; see `triage-labels.md`)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `blueprint/tickets/<slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/mp-wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `blueprint/tickets/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `blueprint/tickets/<effort>/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `blueprint/tickets/<effort>/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
