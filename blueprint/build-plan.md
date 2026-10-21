# Build Plan

List the features that make up your project, high level and in rough build order.
Keep each item to one line; the details come later in `/feature`.

Plain bullets are fine. When both planning docs are ready, run `/overview`.
It adds tracking numbers and checkboxes to your feature list before generating
the project overview.

Run `/feature` to spec the next unchecked item, or `/feature 2` to pick one.
Keep completed items checked and append new features as the project grows.
Do not renumber completed features; their archived specs refer to those IDs.

<!-- ext:begin idfn-edges -->
To build features in parallel with `/avengers`, end an item with the items it
depends on: `_(after: 2, 3)_`, or `_(after: none)_` when it depends on nothing.
Items without a suffix are built in order. `/plan-graph` can add these for you.
<!-- ext:end idfn-edges -->

Scaffolding the app and prototyping its look are pre-build steps, not features.
Start with your first real slice of functionality.

## Your features

Replace these examples with your own features:

- [ ] 1. **Feature one** - description
- [ ] 2. **Feature two** - description
