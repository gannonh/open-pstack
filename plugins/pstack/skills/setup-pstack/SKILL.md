---
name: setup-pstack
description: Configure pstack's provider-qualified models and per-role efforts from the installed catalog. Verifies native and external lanes before writing the override sheet. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

Configure one portable model sheet for the current parent harness. Read [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md) and the installed catalog before probing or writing anything.

- Offerings: `catalog/models.json`
- First-run role map: `catalog/role-defaults.json`

Those files are the contract. Enumerate offerings from the catalog. There is no fixed family count and no hard-coded model list in this skill. Do not add a second configuration file, a runtime resolver, or a weaker-model fallback. CLI model listings are availability evidence; they never mutate the catalog.

Claude Code writes `~/.claude/pstack-models.md` and loads it from `~/.claude/CLAUDE.md` with:

```text
@~/.claude/pstack-models.md
```

Codex writes `~/.codex/pstack-models.md`. Codex has no `@` include, so mirror the sheet's exact bytes inside one bounded block in `~/.codex/AGENTS.md` and retain the sheet as the editable source of truth:

```text
<!-- pstack:models:begin -->
<exact contents of ~/.codex/pstack-models.md>
<!-- pstack:models:end -->
```

## Steps

### 1. Establish the parent

Use the harness and tool surface running this skill: Claude Code or Codex. Environment markers may corroborate that top-level answer, but do not launch a child and ask it to detect where it came from. Record the parent because the same descriptor takes a different route in each harness.

### 2. Load current state

Read `catalog/models.json` and `catalog/role-defaults.json`. Then read the current parent-specific sheet when it exists.

Look up every descriptor in the catalog before applying any migration. A cataloged selector, including an explicit version, is valid loaded state and must be preserved verbatim. Only uncataloged predecessor pins from `legacyMigrations` migrate: Claude `claude-fable-<digits>` becomes `fable`, and `claude-opus-<digits>` becomes `opus`. Preserve provider, effort, role, and lane order. Record each original and migrated descriptor for the confirmation in step 7.

Overlay loaded rows on the complete role map from `role-defaults.json`. Materialize any missing documented role row from that map on the next successful write. A duplicate or unknown role row is inconsistent state; report it and resolve it before probing. A bare host-native slug from an older sheet is also invalid because it does not say which provider owns it. If the sheet is missing, use the complete role-defaults map, including its efforts.

A hand-edited sheet is accepted when every descriptor is `inherit-parent`, `auto`, or a cataloged offering with a supported effort. Running this skill is optional for such a sheet; this run still probes before rewriting files.

### 3. Show current selections and catalog offerings

Parse every non-alias value as `<provider>:<model>@<effort>`. Bind it to exactly one catalog offering by `(provider, selector)` and require its effort to appear in that offering's `supportedEfforts`. `inherit-parent` and `auto` rows carry no offering effort.

An unmatched provider/model, out-of-domain effort, duplicate role, or unknown role is inconsistent state. Stop, show the conflicting rows verbatim, and ask for an explicit cataloged replacement. Mixed efforts across roles or lanes are valid. Do not invent a precedence rule. Do not probe or write while any inconsistency is unresolved.

Enumerate offerings from the catalog at run time. A newly cataloged offering appears in this step without a skill change.

Show:

- Every current role and lane with its verbatim descriptor
- Every catalog offering grouped by family, including alternate providers for the same logical model. For each offering show its label (a rolling alias is labeled "(rolling alias)"), its selector, its supported efforts in catalog order, its default effort, and the copyable `provider:selector@effort` value for every supported effort
- Deprecated offerings with their successor, if any
- Resolution evidence for a rolling alias, only when it is available. Advertised evidence comes from a discovery inventory the operator supplies. Observed evidence comes from a probe receipt's `reportedModel`. Show each with its source and time. Otherwise print unknown. Never invent a resolution.

Do not hide a cataloged Cursor offering when a Claude offering shares the same display name, or the reverse.

A hand-edited descriptor is validated by the same catalog binding as a selection made here. An offering that appears only in a discovery inventory, or that discovery reported as unsupported or unrepresentable, is not selectable. Do not guess a replacement selector for it. It becomes selectable when a maintainer catalogs it with `pstack-models add`.

### 4. Collect named role and lane edits

Ask: **Which named roles or panel lanes do you want to change?** Empty input keeps every current assignment, including lane order and per-lane efforts. That is the common path. Do not walk every role or every panel lane with a question.

On a first run, state that empty input keeps the catalog role-defaults map. On a rerun, state the loaded assignments without offering to reset a customized sheet to first-run defaults.

Named edits:

- A scalar role name replaces that role's descriptor.
- A panel role name replaces the whole comma-separated list, preserving only the lanes the operator supplies, in the order supplied.
- `how critics[3]` (1-based) replaces one panel lane and leaves the other lanes and their order unchanged.

For each named change, ask the operator to pick one catalog offering (provider plus selector) and one effort from that offering's `supportedEfforts`. Empty effort input keeps the current effort when the offering is unchanged, or accepts the offering's default effort when the offering changes. A changed role may also be `inherit-parent` or `auto`.

Apply only the edits the operator names. Untouched selections stay verbatim.

### 5. Probe the exact selections

Probe the unique cataloged `provider:model@effort` descriptors that the rendered sheet will contain. Do not probe aliases. Do not probe offerings the sheet does not use. Do not enumerate or offer older models as substitutes. A failed probe writes nothing: report the failing descriptor and provider, stop, and keep the active sheet plus parent integration bytes unchanged. A failed first run creates neither artifact.

For each unique descriptor, use the parent route table in `provider-dispatch.md`. On a Claude parent, a `claude:*` probe is a one-turn run of `pstack-<nativeAgentStem>-<effort>`. On a Codex parent, a `codex:*` probe is native `spawn_agent` with the selected `reasoning_effort`. Every other pair uses the external runner with the catalog selector and selected effort. Never call the external launcher for the parent's own provider.

Use a tiny read-only probe that returns a unique marker. A login-status command alone proves credentials, not that the requested model and effort flags run. Record native and external results separately.

Receipts and native transcripts prove the requested effort and the route. They do not prove a provider's hidden applied reasoning depth. There is no implicit timeout, weaker-model fallback, same-provider external fallback, automatic provider fallback, or second mutable configuration source.

**Optional execution verification.** Only when the operator explicitly asks, run the probe through the parent-owned route table and record, per descriptor:

- the requested descriptor
- the actual argv, or the native agent name plus effort
- the observed model identity when the provider exposes it
- the source and time of that observation

Never claim hidden applied-effort observability.

### 6. Render, preserving untouched selections

Build the new sheet in memory. Do not write it yet.

- First run with no named edits: render `catalog/role-defaults.json`.
- Otherwise: start from the migrated complete role map from step 2, apply only the named role and lane edits from step 4, and keep every other descriptor verbatim, including mixed efforts and panel order.

Why and Reflect require the parent's live MCP surface. Keep their investigator, reviewer, and synthesizer roles on `inherit-parent` or `auto` unless the operator explicitly names a different cataloged offering; the bounded external runner deliberately omits ambient MCPs. `inherit-parent` and `auto` always validate, but say when they reduce a panel's provider diversity. For panel roles, one lane runs per entry. The list length is the fan-out count. `arena cross-judge pool` is a list from which Arena chooses a provider different from the parent and base candidate when possible. `swarm workers` is the default for every worker unless a race explicitly assigns another descriptor.

Refuse an unqualified slug, an unavailable route, or a descriptor that is not in the catalog with a supported effort. Do not rewrite a valid cataloged descriptor into another model or alias.

### 7. Confirm and commit

Show any predecessor-pin migrations as original and normalized descriptors. Then show the route table for this parent and every rendered role and descriptor. Ask for confirmation before writing.

Every non-alias value must match `<provider>:<model>@<effort>` and must have passed step 5.

After the operator confirms, write the in-memory render from step 6. Never paste a remembered example sheet as the result. Selected offerings and explicit role changes always replace role-defaults values before writing.

### 8. Wire it in

Render the parent integration in memory before either write. On Claude, the integration is the single `@~/.claude/pstack-models.md` include in `~/.claude/CLAUDE.md`. On Codex, it is the exact sheet bytes between one `<!-- pstack:models:begin -->` and `<!-- pstack:models:end -->` pair in `~/.codex/AGENTS.md`. Replace that whole bounded block on a rerun. Insert one block at the end on first run. If either marker is missing, duplicated, or reversed, stop and report inconsistent state instead of guessing a boundary.

Snapshot every target's current bytes. Write the sheet and parent integration only after every unique-descriptor probe passes and the operator confirms. Read both targets back and compare them with the in-memory render. If either write or readback fails, restore every snapshot and report the failure. An unchanged rerun must produce byte-identical sheet and integration content after migration.

Do not copy the model sheet between harnesses without rerunning the parent-specific probes; route availability can differ even on the same host.

### 9. Behavioral smoke

Before declaring setup complete, run one small read-only mixed panel from this parent: the unique probed descriptors, distinct output/receipt paths, and an independent cross-judge. Launch Claude-native agents and every external process in the background with retained handles, then drain them. Verify the native transcript entries and every external receipt. A structural config check or unit test is not a substitute.

Report the sheet path, parent route table, probe results, smoke results, and external elapsed/token/cost receipts. Re-running this skill re-probes and updates the same sheet. Do not claim the provider exposed hidden applied-effort observability.
