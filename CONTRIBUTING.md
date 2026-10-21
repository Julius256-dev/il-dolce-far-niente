# Contributing

Read [docs/DESIGN.md](docs/DESIGN.md) first; it is the contract every change follows.

## Setup

```bash
npm install
npm --prefix packages/il-dolce-far-niente install
npm run check
```

`npm run check` rebuilds nothing; it verifies the adapter trees are current,
runs the static contract, routing evals, transform and hook tests, and the
installer's test suite.

## Editing skills

- Edit `skills/<name>/` only. Then run `npm run build:adapters` and commit the
  regenerated `.claude/skills/` and `.agents/skills/` trees with your change.
- Files that came from upstream (see `upstream.lock.json` mappings) are merged
  with every upstream release. Keep edits small and targeted. Wrap additions to
  Blueprint files in markers so they survive merges:

  ```markdown
  <!-- ext:begin short-name -->
  Your addition.
  <!-- ext:end short-name -->
  ```

- A new skill needs `evals/routing/<name>.json` (at least 3 positive and 2
  negative prompts), a row in the README command table, and an entry in the
  `AGENTS.md` inventory.

## Upstream updates

The weekly `upstream-sync` workflow does this for you. To run it by hand:

```bash
git subtree pull --prefix upstream/ai-blueprint https://github.com/aiblueprinthq/ai-blueprint main --squash
git subtree pull --prefix upstream/mattpocock-skills https://github.com/mattpocock/skills main --squash
npm run sync:upstream -- --report sync-report.md
npm run build:adapters
npm run check
```

Exit code 2 from `sync:upstream` means conflict markers were left in the files
listed under "Conflicts to resolve". Resolve them, rerun the checks, and commit.
Never edit `upstream/` or `.upstream-base/` by hand.

## Releasing

1. Bump `version` in `packages/il-dolce-far-niente/package.json` and
   `plugin/.claude-plugin/plugin.json` together, and update `CHANGELOG.md`.
2. `npm run check`, then `npm run test:package`.
3. Tag `v<version>` and publish from `packages/il-dolce-far-niente`
   (`npm publish`). Plugin users get the new version from the marketplace.
