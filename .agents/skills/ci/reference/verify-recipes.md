# Verify recipes by stack

Starting points for Step 2. Each recipe keeps the typecheck, tests, build order
and drops any check the project does not have. Detect first: never add a
recipe's command when the project has no config or files for it, and never
install a tool to make a recipe fit. `/avengers`, `/continuous` and every
landing run this one command, so it must be fast enough to run after every
landing and must fail on real breakage.

Use pnpm for JavaScript and TypeScript unless the repository already uses npm
or Yarn (its lockfile decides). Do not introduce Bun.

## Next.js / TypeScript

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "verify": "pnpm typecheck && pnpm test && pnpm build"
}
```

```text
Verify: pnpm verify
```

- `pnpm test` only when a runner (Vitest or Jest) and real tests exist.
- `pnpm build` is `next build`. When it needs environment variables, set
  non-secret placeholders in the workflow, never real secrets.
- Workflow setup: `pnpm/action-setup@v4`, then `actions/setup-node@v4` with
  `node-version-file` (`.nvmrc` or `.node-version`) and `cache: pnpm`, then
  `pnpm install --frozen-lockfile`.

## Expo / React Native

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "verify": "pnpm typecheck && pnpm test && pnpm export:check",
  "export:check": "expo export --platform all --output-dir .expo-export-check"
}
```

```text
Verify: pnpm verify
```

- Tests: `jest-expo` with `@testing-library/react-native`, only when configured.
- `expo export` bundles the JavaScript for every platform without native SDKs
  or an EAS account, so it catches broken imports and Metro errors in CI. Add
  `.expo-export-check/` to `.gitignore`. Native builds (EAS) stay out of Verify.
- Workflow setup is the same as Next.js. No simulator is needed.

## Flutter

```text
Verify: flutter analyze && flutter test
```

- `flutter analyze` fails on errors and warnings under the project's
  `analysis_options.yaml`; keep the project's existing lint set.
- `flutter test` runs unit and widget tests, including golden tests.
- A build (`flutter build apk --debug`, `flutter build web`) belongs in Verify
  only when the team asks for it; it needs the platform toolchain on the runner.
- Workflow setup: `subosito/flutter-action@v2` with `channel: stable` (or
  `flutter-version-file: pubspec.yaml` when the version is pinned there), then
  `flutter pub get`.

## Mixed repositories

When one repository holds more than one stack (for example a Next.js web app and
a Flutter app), Verify chains each app's own recipe from the root so one command
still proves everything:

```text
Verify: pnpm -r --if-present verify && (cd apps/driver && flutter analyze && flutter test)
```

The workflow then sets up both toolchains before the single Verify step. Keep
the per-app recipes as each app's own `verify` script or command so a developer
can run one app's checks alone.

## Record it

Write the exact line under Commands in `AGENTS.md`, for example:

```markdown
- Verify: `pnpm verify` (typecheck, tests, build)
```

`/avengers` reads that line and refuses to start without it.
