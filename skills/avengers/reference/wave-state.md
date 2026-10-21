# Wave state record

`/avengers` keeps one generated, Git-ignored record of the active wave at
`blueprint/.state/avengers.json` in the main checkout. It lets `/avengers resume`
and `/status` find the wave's worktrees after a cleared context. Git stays the
source of truth: `avengers.mjs status` checks every claim here against branches,
worktrees and commits.

Only `scripts/avengers.mjs` and `scripts/land.mjs` write it, atomically. Never
edit it by hand, and never put secrets, prompts, raw logs or user content in it.

```json
{
  "schemaVersion": 1,
  "wave": 3,
  "status": "building",
  "defaultBranch": "main",
  "startCommit": "<full SHA of the default branch when the wave started>",
  "integrationBranch": "wave/3",
  "integrationWorktree": "/abs/path/.worktrees/shop-wave-3",
  "portBase": 4100,
  "verifyCommand": "npm run verify",
  "startedAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>",
  "models": {
    "planner": { "model": "claude-opus-5-5", "family": "opus", "effort": "medium" },
    "implementer": { "model": "claude-sonnet-5-5", "family": "sonnet", "effort": null }
  },
  "items": [
    {
      "id": "4",
      "title": "Export reports",
      "branch": "feature/export-reports",
      "worktree": "/abs/path/.worktrees/shop-export-reports",
      "port": 4101,
      "forkPoint": "<full SHA of the integration tip this branch was created from>",
      "buildAttempt": 1,
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

Per-item scratch (reviewer JSON, the try guide) lives in
`blueprint/.state/avengers/` inside each worktree; it is Git-ignored and removed
with the worktree. `avengers.mjs close` deletes the record after the wave lands.
