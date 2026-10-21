---
name: install
description: Install or update Il Dolce Far Niente in the current project by running its npm installer, then point to /onboard. Use when the user asks to install, set up, add or update Il Dolce Far Niente, AI Blueprint with /avengers, or this workflow in their repo.
---

# Install Il Dolce Far Niente

The workflow lives in the project itself (`AGENTS.md`, `CLAUDE.md`, `.claude/`,
`.agents/`, `blueprint/`), so every teammate and every agent sees the same files.
This plugin only runs the installer; it adds no workflow skills of its own.

1. Confirm the current directory is the root of a Git repository with a
   scaffolded app. If the folder is empty, tell the user to scaffold the app
   first (any stack) and stop.
2. Check whether `blueprint/.state/manifest.json` exists.
   - Missing: the command is `npx il-dolce-far-niente@latest`.
   - Present: the command is `npx il-dolce-far-niente@latest update`.
3. Show the exact command and what it will do, and ask for a yes. Never run it
   without one.
4. Run it in a terminal the user can watch; the installer asks which tools
   (Claude Code, Codex, Copilot, Antigravity, OpenCode) to install for. If it
   reports conflicts with locally edited files, show them and let the user decide.
5. After a fresh install, tell the user to restart the session so the new skills
   load, then run `/onboard`. After an update, summarize what changed.
