# Flutter standards (starting point)

`/onboard` uses this to replace the Next.js sections of
`blueprint/context/coding-standards.md` in a Flutter project. Keep the Team
conventions section; trim anything the project does not use.

## Dart

- Sound null safety; avoid `!` except where a value is proven non-null
- `flutter analyze` clean under the project's `analysis_options.yaml`
- `dart format` style; `final` by default, `const` constructors where possible

## Structure

- Feature-first folders under `lib/features/<feature>/` (data, domain,
  presentation), shared code in `lib/core/`
- One public widget per file; private helpers below it

## Widgets

- Small, composable widgets; extract when a `build` method passes ~80 lines
- Stateless by default; state lives in the project's chosen state management
  (Riverpod, Bloc or Provider), never in global singletons
- No business logic or network calls in `build`

## Data

- Repositories wrap APIs and storage; widgets talk to state, not to HTTP
- Model classes are immutable, with `fromJson`/`toJson` (generated or written)
- Secrets never ship in the app binary

## Testing

- Unit tests for logic, widget tests for UI behavior (`WidgetTester`)
- Golden tests for screens whose look is a requirement; never update goldens to
  make a failing test pass
- Visual claims are proved with a simulator screenshot or golden image (see
  `/check`'s mobile recipe)

## Naming

- Files: `snake_case.dart`
- Classes and widgets: PascalCase
- Members and variables: camelCase; constants: lowerCamelCase per Dart style
