# Axis review output

The `reviewer-standards` and `reviewer-spec` agents never edit the findings
ledger. Each writes one JSON file in the item's worktree, and the orchestrator
records it with `avengers.mjs record --id <n>`, which numbers new findings,
writes the ledger blocks in Audit's Step 4 shape and applies verdicts.

Path: `blueprint/.state/avengers/review-<axis>.json` (`standards` or `spec`).
The folder is Git-ignored scratch.

```json
{
  "axis": "standards",
  "reviewer": "reviewer-standards",
  "model": "claude-opus-5-5",
  "effort": "medium",
  "target": "<full target SHA from the task>",
  "findings": [
    {
      "severity": "P2",
      "title": "One line naming the defect",
      "file": "src/reports/export.ts:42",
      "why": "One or two sentences: the concrete risk.",
      "fix": "One or two sentences: the smallest correct repair.",
      "status": "open"
    }
  ],
  "verdicts": [
    { "id": "F-03", "status": "closed", "evidence": "export.ts:42 now guards empty rows; no new issue in the repair." }
  ]
}
```

- `model` is the exact model your runtime reports, or
  `unknown (runtime did not expose exact model)`. Never guess.
- `target` must equal the target in your task; a stale file is refused.
- `findings` holds only **new** confirmed defects on your axis. Use `status`
  `unverified` for a suspicion without evidence. Never repeat an existing entry.
- `verdicts` covers every existing `fixed` finding on your axis: `closed` (the
  repair works and introduced nothing new), `open` (still broken) or `invalid`
  (the finding was wrong). Verdicts for other statuses or axes are refused.
- Empty arrays are a valid, explicit "nothing found".
- Severity: an unmet done-when, likely bug, broken contract or missing guard is
  `P1`; a documented-standard breach or scope gap otherwise `P2`; baseline smells
  `P3`. `P0` is data loss, a security break or code that cannot ship.
