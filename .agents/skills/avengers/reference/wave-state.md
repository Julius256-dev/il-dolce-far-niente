# Wave state record

`/avengers` keeps one generated, Git-ignored record of the active wave at
`blueprint/.state/avengers.json`. It lets `/avengers resume` and `/status` find
the wave's worktrees after a cleared context. Git stays the source of truth: on
resume, every claim here is checked against branches, worktrees and commits.

Write it atomically (write a temporary file in the same folder, then rename).
Never put secrets, prompts, raw logs or user content in it.

```json
{
  "schemaVersion": 1,
  "wave": 3,
  "status": "building",
  "defaultBranch": "main",
  "startCommit": "<full SHA of the default branch when the wave started>",
  "integrationBranch": "wave/3",
  "integrationWorktree": "../.worktrees/shop-wave-3",
  "startedAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>",
  "models": {
    "planner": { "model": "claude-opus-5-5", "effort": "medium" },
    "implementer": { "model": "claude-sonnet-5-5" },
    "merger": { "model": "claude-sonnet-5-5" },
    "reviewer-lens": { "model": "claude-opus-5-5", "effort": "medium" },
    "reviewer-standards": { "model": "claude-opus-5-5", "effort": "medium" },
    "reviewer-spec": { "model": "claude-opus-5-5", "effort": "medium" }
  },
  "items": [
    {
      "id": "4",
      "title": "Export reports",
      "branch": "feature/export-reports",
      "worktree": "../.worktrees/shop-export-reports",
      "port": 4101,
      "forkPoint": "<full SHA of the integration tip this branch was created from>",
      "status": "reviewing",
      "repairAttempts": 0,
      "reviewTarget": "<full SHA>",
      "landedCommit": null,
      "blockedReason": null,
      "question": null
    }
  ],
  "deferred": [{ "id": "5", "reason": "overlaps item 4 in src/reports" }]
}
```

`status` (wave): `speccing`, `awaiting-approval`, `building`, `integrating`,
`ready-to-land`, `landed`, `blocked`.

`status` (item): `speccing`, `awaiting-approval`, `implementing`, `verifying`,
`reviewing`, `repairing`, `ready-to-land`, `landing`, `landed`, `blocked`,
`dropped`. A `dropped` item records the exact decision it waits for in
`question`; a `blocked` item records why in `blockedReason`.

Delete the record after the wave lands and its worktrees are removed.
