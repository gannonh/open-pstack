# Models, catalog, and routing

pstack routes each role with a portable descriptor:

```text
provider:model@effort
```

`inherit-parent` and `auto` use the parent session's model natively. They still count as one panel lane.

The **model sheet** is the operator's routing control. The **catalog** is the repository-maintained list of offerings those descriptors may name. Runtime executes a valid selection exactly, or records a loud dropout. It never silently substitutes a model or provider.

## Where the files live

| File | Role |
| --- | --- |
| `plugins/pstack/catalog/models.json` | Canonical offerings: display name, provider, selector, supported efforts, selector composition, native-agent stem |
| `plugins/pstack/catalog/role-defaults.json` | First-run role and panel-lane assignments |
| `~/.claude/pstack-models.md` or `~/.codex/pstack-models.md` | Operator sheet (Claude include / Codex bounded block) |

Providers are predefined: `claude`, `codex`, `cursor`, and `grok`. A catalog PR cannot invent a new provider string without a checked-in adapter.

## Update the catalog by PR

To record that a model is available, for example “Fable 5.1 is available from Claude and Cursor”:

1. Add or edit an offering in `plugins/pstack/catalog/models.json`. Keep `displayName` (human identity) separate from `selector` (provider CLI stem) when they differ.
2. Set `selectorComposition` to `effort-flag` (Claude, Codex, Grok) or `effort-suffix` (Cursor, which composes `<selector>-<effort>`).
3. List `supportedEfforts` and a `defaultEffort` that appears in that list.
4. For a Claude offering, set `nativeAgentStem` and `nativeAgentTitle`, then regenerate native agent files:

   ```shell
   bun plugins/pstack/skills/poteto-mode/scripts/runner/generate-native-agents.ts
   ```

5. Update tests that assert the new offering, plus `CHANGES.md` / `NOTICE.md` as needed.
6. Do **not** edit Arena, Architect, How, Interrogate, setup control flow, or runner provider switch cases. Those read the catalog.

Deprecate an offering with `"deprecated": true` and an optional `successorId`. Deprecated offerings still validate and dispatch so existing sheets keep working. Setup warns. Removing an offering is a later PR; sheets that still name it then fail validation.

Do not discover models from `claude`, `codex`, `grok`, or `cursor-agent` listings and write them into the catalog. Those listings are availability evidence only.

## Edit role selections directly

The sheet syntax is unchanged. A hand-edited sheet is valid when every descriptor is `inherit-parent`, `auto`, or a cataloged `provider:selector@effort` whose effort is supported for that offering. Running setup is optional.

Example: move judgment from Claude Fable to Cursor Fable 5.1 after Claude quota is exhausted:

```text
judgment and prose: cursor:claude-fable-5-1@max
```

Effort is per role and per panel lane. Two Fable roles may use different supported efforts. Panel lists remain fan-out, not ordered fallback.

Existing 1.3.1 sheets that already use the rolling Claude aliases, GPT-5.6 Sol, Cursor Grok 4.6, `inherit-parent`, and `auto` keep their assignments. Uncataloged predecessor version pins migrate in memory to the cataloged rolling alias; setup persists that after probes.

An invalid or unavailable descriptor is a validation or probe failure. Setup does not write. Runtime availability failures are dropouts with receipts. There is no automatic quota-aware reroute.

## Run setup as a guided editor and probe

In Claude Code: `/pstack:setup-pstack`. In Codex: ask for `pstack:setup-pstack`.

Setup loads the catalog and the current sheet, shows current selections plus every cataloged offering (including alternate providers for the same logical model), and asks which **named** roles or panel lanes to change. Empty input keeps everything. `how critics[3]` changes one panel lane without walking the whole list.

It then probes the exact unique descriptors from the current parent harness. A failed probe leaves the active sheet and parent integration bytes unchanged and reports the failing descriptor. After confirmation it writes the Claude include or the Codex bounded block.

## Manual reroute during a provider outage

“Fallback” here means an explicit operator change, not automatic substitution.

1. Open the parent sheet (`~/.claude/pstack-models.md` or `~/.codex/pstack-models.md`).
2. Replace affected role or lane descriptors with another cataloged offering, for example Cursor Fable 5.1 instead of Claude Fable.
3. Optionally rerun setup so it probes the new descriptors before writing.
4. Keep Why and Reflect on `inherit-parent` or `auto` unless you accept losing the parent's live MCP surface.

The same sheet is interpreted from Claude Code and Codex. Each parent chooses native versus external execution from the route table while preserving the selected provider model.
