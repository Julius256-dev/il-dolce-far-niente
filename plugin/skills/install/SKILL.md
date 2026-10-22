---
name: install
description: Install or update Il Dolce Far Niente in the current project by running its npm installer, then point to /onboard. Use when the user asks to install, set up, add or update Il Dolce Far Niente, AI Blueprint with /avengers, or this workflow in their repo.
---

# Install Il Dolce Far Niente

The workflow lives in the project itself (`AGENTS.md`, `CLAUDE.md`, `.claude/`,
`.agents/`, `blueprint/`), so every teammate and every agent sees the same files.
This skill only runs the installer; it adds no workflow skills of its own. It
works the same from Claude Code, Codex, GitHub Copilot or any agent that got it
from skills.sh.

1. Confirm the current directory is the root of a Git repository with a
   scaffolded app. If the folder is empty, tell the user to scaffold the app
   first (any stack) and stop. Node.js 22 or newer must be on the `PATH`.
2. If `blueprint/config.json` has `"profile": "restricted"`, stop and point to
   `reference/restricted.md` in the onboard skill: the client's written answer
   on whether source code may leave the premises comes before any agent work.
3. Check whether `blueprint/.state/manifest.json` exists.
   - Missing: install. Ask which tools the team uses and pass one flag for each:
     `--claude`, `--codex`, `--copilot`, `--opencode`, `--antigravity` (or
     `--all`). Without flags and without a terminal the installer adds every
     adapter, so always pass them. Command:
     `npx --yes il-dolce-far-niente@latest -- --claude --codex` (for example).
   - Present: update. Command: `npx --yes il-dolce-far-niente@latest update`.
     Add a flag only to add another tool.
4. Show the exact command and what it will do, and ask for a yes. Never run it
   without one.
5. Run it. When it reports files that already exist (install) or conflicts
   with locally edited files (update), it stops without changing them: show the
   list and let the user decide. Re-run with `--force` only after they say so;
   the update backs replaced files up under `blueprint/.state/backups/`.
6. After a fresh install, tell the user to restart the session so the new
   skills load, then run `/onboard` (or `$onboard`). After an update, summarize
   what changed from the installer's report and suggest committing the update
   on its own branch.
