---
name: mp-grill
description: A relentless interview to sharpen a plan or design, which also creates domain docs (ADRs and glossary) as we go. Use only for /mp-grill.
disable-model-invocation: true
metadata:
  internal: true
---

# Grill

**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.

Call the Skill tool twice, for "mp-grilling" and "mp-domain-modeling". The glossary and ADR locations come from `domainDocs` in `blueprint/config.json` (defaults `GLOSSARY.md` and `docs/adr`).
