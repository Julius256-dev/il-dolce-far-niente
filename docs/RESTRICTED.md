# Restricted repositories

The guide ships with the skills, so it is in every installed project:
[`skills/onboard/reference/restricted.md`](../skills/onboard/reference/restricted.md)
(installed as `.claude/skills/onboard/reference/restricted.md` and
`.agents/skills/onboard/reference/restricted.md`).

In short: get the client's written answer to "may this source code leave the
premises?" before any agent runs, record it in `blueprint/config.json`
(`dataHandling`), keep `research.web` off, run on a locally hosted model when the
answer is no, and enforce it with `.claude/hooks/data-handling.mjs`.
