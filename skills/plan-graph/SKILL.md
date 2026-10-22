---
name: plan-graph
description: "Slice the remaining build plan into vertical slices and record dependency edges as _(after: n)_ suffixes on build-plan items, rejecting cycles and showing the parallel frontier for /avengers. Use only for /plan-graph or a direct dependency-graph request."
disable-model-invocation: true
metadata:
  internal: true
---

# Plan Graph

**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.

Break the remaining build plan (or a spec, or a wayfinder destination) into **tracer-bullet vertical slices**, and record each slice's **blocking edges**: the items that must be checked before it can start. The edges live in `blueprint/build-plan.md` as `_(after: n, m)_` suffixes, so `/avengers` can build every unblocked item in parallel.

This skill is explicit-only. It writes only `blueprint/build-plan.md`, and tracker tickets when the user asks for them (step 6).

## The edge format

`/avengers` and `/status` read this exact form, so never vary it. A leaf item may end with an `after` suffix listing the item numbers that must be checked first:

```markdown
- [ ] 4. **Export reports** - CSV and PDF downloads _(after: 2, 3)_
```

- No suffix means the item depends on every earlier unchecked item (Blueprint's serial behavior), so the first unchecked item needs no suffix to be on the frontier.
- `_(after: none)_` means the item depends on nothing and is on the frontier immediately.
- A suffix that names only checked items also puts the item on the frontier.
- Numbers are build-plan IDs, including lettered sub-items (`4a`). Comma-separated, ascending, no duplicates, no self-reference.
- Edges go on **leaf** items only (an item with lettered children is a parent, not a leaf).

## Rules

- Only **unchecked** items get edges. Never renumber, retitle, reorder, or otherwise edit a checked item: archived specs refer to those IDs.
- An edge may only name an item that **exists** in the plan, at the **same or a shallower nesting level** than the item carrying it (a lettered sub-item may name `3` or a sibling `4a`; a top-level item never names another item's lettered sub-item, it names the parent).
- An edge naming a parent waits for all of the parent's leaves.
- **Reject cycles.** Before showing or writing anything, walk the graph; if any cycle exists, show it (`5 → 7 → 6 → 5`) and ask which edge to drop. Never write a plan containing a cycle.
- New slices are **appended** to the plan with the next free numbers, and only after the user approves them. Do not insert new top-level items between existing ones; the only in-place addition is splitting an unchecked item into lettered sub-items under it (`/feature`'s convention), which moves its suffix onto the sub-items.
- Leave the description and title text of existing unchecked items alone unless the user approves a change; add or replace only the `_(after: …)_` suffix.

## Process

### 1. Gather context

Read `blueprint/build-plan.md`. Work from whatever else is already in the conversation context. If the user passes a reference (a spec path such as `blueprint/context/current-feature.md`, a wayfinder map, an issue number or URL) as an argument, fetch it and read its full body and comments. Read only the passages of `blueprint/context/project-overview.md` that the unchecked items depend on.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Slice titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching (the glossary and ADR locations come from `domainDocs` in `blueprint/config.json`; defaults `GLOSSARY.md` and `docs/adr`).

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** slices. Existing unchecked items that already are good slices stay as they are; propose a split (lettered sub-items, as `/feature` does) or new appended items only where an item is too big, is a horizontal layer, or is missing.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each slice its **blocking edges**: the other items that must complete before it can start. Prefer the fewest edges that are genuinely true: every unnecessary edge removes parallelism, every missing edge risks two worktrees colliding. Two slices that edit the same shared files, migrations, auth, payments, or config should be ordered by an edge even when neither logically needs the other (`/avengers` also serializes these, per `avengers.serializeWhen`).

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own item blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in an item blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify item; green is promised only there.

### 4. Quiz the user

Present the proposed graph as a numbered list in build-plan order. For each unchecked item, show:

- **Title**: short descriptive name (mark new or split items as **new**)
- **After**: which items (if any) must be checked first
- **What it delivers**: the end-to-end behaviour this item makes work

Also show the resulting **frontier** (unchecked items whose blockers are all checked) and the longest chain, so the user sees how much parallelism the graph buys.

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each item only depend on items that genuinely gate it?
- Should any items be merged or split further?

Iterate until the user approves the breakdown. Re-run the cycle check after every change.

### 5. Write the build plan

After approval, edit `blueprint/build-plan.md` once:

- add or replace the `_(after: …)_` suffix at the end of each approved unchecked leaf line;
- append approved new items (and lettered sub-items under their parent) with the next free numbers;
- touch nothing else.

Then show the resulting **frontier**: every unchecked leaf whose blockers are all checked (an item with no suffix is on the frontier only when every earlier unchecked item is checked). Point the user to `/avengers` to build the frontier in parallel, or `/feature` to spec one item at a time.

### 6. Publish tickets (optional)

Only when `tracker.kind` in `blueprint/config.json` is `github` or `gitlab` **and** the user asks, also publish the approved items as tickets. Read the tracker doc named by `tracker.doc` (default `blueprint/context/tracker.md`) for the commands; if it is missing, suggest `/onboard` and skip publishing.

Publish one issue per item in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the platform's native blocking relationship where it has one; otherwise set each ticket's "Blocked by" to the blocking issues. If the source was an existing issue, make each ticket its sub-issue (tracker doc's operation). Apply the `ready-for-agent` label string from `tracker.labels` unless instructed otherwise. Do NOT close or modify any parent issue. The build plan stays the source of truth for `/avengers`; tickets mirror it.

<issue-template>

## Parent

A reference to the parent issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective, not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None (can start immediately)". Omit this section when blockers were set as native edges.

</issue-template>

In either form, avoid specific file paths or code snippets: they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.
