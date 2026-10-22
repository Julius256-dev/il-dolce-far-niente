---
name: mp-tdd
description: Test-driven development discipline (red-green loop, good tests at agreed seams, mocking, anti-patterns). Use when building features or fixing bugs test-first, writing a failing test before the code, "red-green-refactor", or adding integration tests when the project has a test command.
metadata:
  internal: true
---

# Test-Driven Development

**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

Testing applies only when the project has a test command: Blueprint's Testing gate in `blueprint/context/coding-standards.md` (a `test` command in the Commands section of `AGENTS.md`) is the switch. Without one, verify logic with the evidence the workflow already uses and don't install a runner mid-step; `/tests` adds one.

When exploring the codebase, read the glossary (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching. Their locations come from `domainDocs` in `blueprint/config.json` (defaults `GLOSSARY.md` and `docs/adr`).

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification: "user can checkout with valid cart" tells you exactly what capability exists, and it survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test. Inside Blueprint the seams were agreed at spec approval: they are the approved spec's `## Testing` section in `blueprint/context/current-feature.md`, so use those without asking again. Confirm seams with the user only when the spec names none (or there is no spec). No test is written at an unconfirmed seam; a step that surfaces logic the spec didn't foresee gets a focused test at the nearest agreed seam, or a question. You can't test everything, so agreeing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

When you must ask: "What's the public interface, and which seams should we test?" Give each proposed seam a one-line note on what it catches and what it misses.

When the shape of that interface is itself in question (how deep the module is, where the seam belongs, what the interface should expose), call the Skill tool with "mp-codebase-design" for the vocabulary. It is the shared source of the module, interface, depth, seam, adapter, leverage and locality terms, and it is a reference to consult, not a session to run.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological**: the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth: a known-good literal, a worked example, the spec.
- **Horizontal slicing**: writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead: one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage (see the `mp-code-review` skill), not the red → green implementation cycle.
