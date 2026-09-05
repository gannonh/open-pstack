# pstack model catalog

Canonical data for supported model offerings and first-run role assignments. Setup, dispatch, the runner, and tests read these files. Workflow skills do not copy model slugs.

| File | Owns |
| --- | --- |
| `models.json` | Provider offerings: identity, selector, efforts, composition, native-agent stem |
| `role-defaults.json` | Default descriptor per named role and panel lane |

To add, update, deprecate, or remove an offering, edit the JSON, update tests and release notes, and regenerate Claude-native agent files when a Claude offering changes. Do not edit Arena, Architect, How, Interrogate, setup control flow, or runner provider switch cases.

See [docs/models.md](../../../docs/models.md) for the operator and maintainer guide.
