# pstack model catalog

Canonical data for supported model offerings and first-run role assignments. Setup, dispatch, the runner, and tests read these files. Workflow skills do not copy model slugs.

| File | Owns |
| --- | --- |
| `models.json` | Provider offerings: identity, selector, per-offering efforts, composition, native-agent stem, rolling-alias flag |
| `role-defaults.json` | Default descriptor per named role and panel lane |

Change membership with `pstack-models` at [`../skills/poteto-mode/scripts/runner/pstack-models`](../skills/poteto-mode/scripts/runner/pstack-models). `discover` records what the provider CLIs advertise without touching these files. `add`, `edit`, and `remove` preview a diff, validate the whole proposed catalog against `role-defaults.json`, and regenerate the Claude-native agent files under `../agents/`. `validate` checks structure, role defaults, canonical format, and generated agents. Do not edit Arena, Architect, How, Interrogate, setup control flow, or runner provider switch cases.

See [docs/models.md](../../../docs/models.md) for the operator and maintainer guide.
