# Mobile check recipe (Expo and Flutter)

Use this instead of the browser path when the claim lives in an Expo/React
Native or Flutter app. The aim is the same as for the web: observed evidence for
every done-when, never a pass read from the code. It is built so the check gate
finishes on a machine without a simulator instead of stalling.

Read `AGENTS.md` Commands first. Two optional lines make the recipe repeatable,
and `/check` uses them exactly when present:

```markdown
- Mobile tests: `pnpm test --testPathPattern=components` (or `flutter test`)
- Mobile screenshot: `maestro test .maestro/smoke.yaml` (or another exact command)
```

Save screenshots and logs under `blueprint/.state/evidence/<feature-id>/`
(Git-ignored) and name each file after the claim it proves.

## 1. Component or widget tests (always)

Run the focused tests that exercise each claim, then the whole suite once.

- **Expo:** `jest-expo` with `@testing-library/react-native`. Query by role or
  text the way a user would, and fire the real events (`press`, `changeText`).
- **Flutter:** widget tests with `WidgetTester`: `pumpWidget`, `tap`,
  `enterText`, `pumpAndSettle`, then `expect` on what is on screen.

A passing test is evidence for the behavior it asserts, not for layout or look.
When a claim has no test, say so; do not write tests from `/check` (that is
`/implement`'s job).

## 2. A screenshot of each visual claim

Take the first path that works, and say which one you used:

1. **Simulator or emulator** (strongest). Start the app on a booted device:
   Expo with `npx expo run:ios` / `npx expo run:android` (or `npx expo start`
   with a development build), Flutter with `flutter run -d <device>`. Drive it to
   the claim (by hand through Maestro, or with an integration test), then capture:
   - iOS simulator: `xcrun simctl io booted screenshot <file>.png`
   - Android emulator: `adb exec-out screencap -p > <file>.png`
   - Flutter, any device: `flutter screenshot --out=<file>.png`
   - Maestro flows: a `- takeScreenshot: <name>` step
   Also capture the device log for the run (`npx expo` output, `flutter logs`,
   `adb logcat -d`) and treat a red box, an unhandled exception or a crash as a
   failure, the same way the web check treats console errors.
2. **Flutter golden test** (no device needed). A widget test that renders the
   screen and compares it with `matchesGoldenFile`. The golden image is the
   screenshot; attach its path. Never run `--update-goldens` to turn a failing
   comparison green. A new golden for new UI is created by `/implement` and
   checked here by looking at the image.
3. **Expo web build** (only when the app already supports web through
   `react-native-web`). `npx expo export --platform web`, serve the output, and
   use the web check's browser path for the screenshot. Note that it shows the
   web rendering, not iOS or Android.

## 3. Report

Use the normal `/check` verdict lines. For each visual claim name the path used:

    [pass] Pay button disabled until amount entered - widget test pay_button_test.dart; golden goldens/pay_button_disabled.png
    [pass] Receipt screen shows UGX total - iOS simulator screenshot receipt-total.png, no errors in device log
    [skip] Push notification arrives - needs a physical device; not verifiable here

With `verification.uiEvidence: "required"`, a simulator screenshot or a golden
image counts as direct UI evidence; component or widget tests alone do not. When
neither is available, mark the claim unverifiable, set `verification incomplete`,
and name the missing piece (a booted simulator, a golden test, or `/tests` to add
one). That is a precise, finishable result, not a stall.

## What never counts

- A green build or a passing `expo export` / `flutter analyze` for a UI claim.
- A screenshot of a different screen, platform or app state than the claim.
- Reading the widget tree or JSX and reasoning about what it would show.
