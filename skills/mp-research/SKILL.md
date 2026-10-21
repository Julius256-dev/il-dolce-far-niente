---
name: mp-research
description: Investigate a question against high-trust primary sources (official docs, source code, specs, first-party APIs) in a background agent and save cited findings to blueprint/research/. Use when the user wants a topic researched, library or API facts gathered, or reading legwork delegated.
---

# Research

**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.

Spin up a **background agent** (the `explorer` role model from `models.roles` in `blueprint/config.json`, when set) to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it as `blueprint/research/<slug>.md` (cited Markdown; `<slug>` is the question in lowercase kebab-case), creating the folder if needed, and say where. Write nothing else in the repo: research never edits code, plans, or specs.
