# Triage Labels

Reference for `/onboard`. The skills speak in terms of canonical triage roles (five states plus the `bug` and `enhancement` categories). The mapping to the actual label strings used in this repo's issue tracker lives in `tracker.labels` in `blueprint/config.json`; `/onboard` fills it from this table and may copy the table into `blueprint/context/tracker.md` for humans.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `bug`                      | `bug`                | Something is broken                      |
| `enhancement`              | `enhancement`        | New feature or improvement               |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column (and `tracker.labels`) to match whatever vocabulary you actually use. A key missing from `tracker.labels` means the canonical name.
