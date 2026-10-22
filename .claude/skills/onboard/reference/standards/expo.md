# Expo / React Native standards (starting point)

`/onboard` uses this to replace the Next.js sections of
`blueprint/context/coding-standards.md` in an Expo project. Keep the Team
conventions section; trim anything the project does not use.

## TypeScript

- Strict mode; no `any` (use proper types or `unknown`)
- Type props, navigation params and API responses

## Components

- Function components and hooks only
- One job per component; move reusable logic into hooks under `src/hooks/`
- Styles with `StyleSheet.create` or the project's chosen styling library,
  never inline objects re-created on every render in lists

## Navigation and routing

- Expo Router: screens in `app/`, shared UI in `src/components/`
- Typed routes; no string-built paths

## Platform and native

- Prefer Expo SDK modules over community native modules
- Gate platform differences with `Platform.select` or `.ios.tsx` / `.android.tsx`
  files, not scattered `Platform.OS` checks
- Secrets never ship in the bundle: no API secrets in `app.config` or
  `EXPO_PUBLIC_*` variables

## Data and state

- Server state through the project's query library; local UI state in the
  component
- Network calls in `src/lib/` or `src/api/`, never in components

## Testing

- `jest-expo` with `@testing-library/react-native`; query by role and text
- Test behavior through the screen or component, not implementation details
- Visual claims are proved with a simulator screenshot (see `/check`'s mobile
  recipe)

## Naming

- Components and screens: PascalCase files
- Hooks: `useThing.ts`
- Constants: SCREAMING_SNAKE_CASE
