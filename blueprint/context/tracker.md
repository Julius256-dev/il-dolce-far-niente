# Issue tracker

This project tracks issues as local Markdown files. `/onboard` rewrites this file
when you choose GitHub Issues or GitLab instead.

- Tickets live in `blueprint/tickets/<slug>/`, one file per ticket, numbered in
  dependency order (`01-<slug>.md`, `02-<slug>.md`).
- Each ticket names its blockers under **Blocked by** and its state under
  **Status**, using the label strings in `tracker.labels` in
  `blueprint/config.json`.
- Close a ticket by setting its status to `done` and noting the commit or
  archived spec that resolved it.
