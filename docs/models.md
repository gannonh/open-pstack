# Models, catalog, and routing

pstack routes each role with a portable descriptor:

```text
provider:selector@effort
```

`inherit-parent` and `auto` use the parent session's model natively. They still count as one panel lane.

The **model sheet** is the operator's routing control. The **catalog** is the repository-maintained list of offerings those descriptors may name. Runtime executes a valid selection exactly, or records a loud dropout. It never substitutes a model, provider, or effort.

## Where the files live

| File | Role |
| --- | --- |
| `plugins/pstack/catalog/models.json` | Canonical offerings: display name, provider, selector, selector composition, supported efforts, default effort, native-agent stem, rolling-alias flag |
| `plugins/pstack/catalog/role-defaults.json` | First-run role and panel-lane assignments |
| `plugins/pstack/agents/pstack-<stem>-<effort>.md` | Claude-native agent files generated from the Claude offerings |
| `plugins/pstack/skills/poteto-mode/scripts/runner/pstack-models` | Maintainer command for discovery and catalog membership |
| `~/.claude/pstack-models.md` or `~/.codex/pstack-models.md` | Operator sheet (Claude include / Codex bounded block) |

Providers are predefined: `claude`, `codex`, `cursor`, and `grok`. A catalog change cannot invent a new provider string without a checked-in adapter.

## Operator guide

### Edit role selections directly

A hand-edited sheet is valid when every descriptor is `inherit-parent`, `auto`, or a cataloged `provider:selector@effort` whose effort appears in that offering's `supportedEfforts`. Running setup is optional.

Example: move judgment from Claude's rolling Fable alias to Cursor Fable 5.1 after Claude quota is exhausted.

```text
judgment and prose: cursor:claude-fable-5-1@max
```

Example: pin judgment to the explicit Claude Fable 5.1 offering with the 1M context modifier.

```text
judgment and prose: claude:claude-fable-5-1[1m]@max
```

Effort is per role and per panel lane. Each offering defines its own ordered effort list, so two roles on different offerings may use efforts that only one of those offerings lists. Every entry in a panel list runs. List order is fan-out order, and no entry is a fallback for another.

Existing sheets that already use the rolling Claude aliases, GPT-5.6 Sol, Cursor Grok 4.6, `inherit-parent`, and `auto` keep their assignments. Uncataloged predecessor version pins migrate in memory to the cataloged rolling alias; setup persists that after probes. A cataloged explicit version stays unchanged.

An invalid or unavailable descriptor is a validation or probe failure. Setup does not write. Runtime availability failures are dropouts with receipts. There is no automatic quota-aware reroute.

### Run setup as a guided editor and probe

In Claude Code: `/pstack:setup-pstack`. In Codex: ask for `pstack:setup-pstack`.

Setup loads the catalog and the current sheet. It shows current selections plus every cataloged offering, including alternate providers for the same logical model. Each offering appears with its label, selector, supported efforts in catalog order, default effort, and a copyable `provider:selector@effort` value for every supported effort. Rolling aliases are labeled "(rolling alias)". Resolution evidence appears only when setup has it (see [Rolling aliases versus explicit pins](#rolling-aliases-versus-explicit-pins)); otherwise it prints unknown.

Setup asks which **named** roles or panel lanes to change. Empty input keeps everything. `how critics[3]` changes one panel lane without walking the whole list. For a changed role, setup offers that offering's efforts in catalog order and accepts the default effort on empty input.

It then probes the exact unique descriptors from the current parent harness. A failed probe leaves the active sheet and parent integration bytes unchanged and reports the failing descriptor. After confirmation it writes the Claude include or the Codex bounded block.

### Manual reroute during a provider outage

A reroute is an explicit operator change. Nothing reroutes automatically.

1. Open the parent sheet (`~/.claude/pstack-models.md` or `~/.codex/pstack-models.md`).
2. Replace affected role or lane descriptors with another cataloged offering, for example Cursor Fable 5.1 instead of Claude's rolling Fable alias.
3. Optionally rerun setup so it probes the new descriptors before writing.
4. Keep Why and Reflect on `inherit-parent` or `auto` unless you accept losing the parent's live MCP surface.

The same sheet is interpreted from Claude Code and Codex. Each parent chooses native versus external execution from the route table while preserving the selected provider model.

### Codex sheet and the `~/.codex/AGENTS.md` block

Claude Code loads `~/.claude/pstack-models.md` through an `@` include in `~/.claude/CLAUDE.md`. Codex has no include, so setup mirrors the sheet's exact bytes into one bounded block in `~/.codex/AGENTS.md`:

```text
<!-- pstack:models:begin -->
<exact contents of ~/.codex/pstack-models.md>
<!-- pstack:models:end -->
```

The sheet is the source of truth. The block is a byte-for-byte copy. Setup rewrites the whole block on every successful write and leaves text outside the markers untouched. A missing, duplicated, or reversed marker pair is inconsistent state; setup stops and reports it.

A hand edit to `~/.codex/pstack-models.md` leaves the block stale until it is re-synced. Either rerun setup, which re-probes and rewrites the block from the sheet, or edit both files so the block again holds the sheet's exact bytes.

## Maintainer guide

Catalog membership changes through `pstack-models`, a Bun command in a checkout of this repository:

```shell
plugins/pstack/skills/poteto-mode/scripts/runner/pstack-models <subcommand> [options]
```

| Subcommand | Effect |
| --- | --- |
| `discover` | Ask the installed provider CLIs what they advertise. Read-only. |
| `list` | Print catalog membership with copyable descriptors and resolution evidence. |
| `add <provider:selector>` | Propose a new offering, preview the diff, write after confirmation. |
| `edit <offering-id>` | Change fields of an existing offering the same way. |
| `remove <offering-id>` | Delete an offering that nothing references. |
| `validate` | Check the shipped catalog, role defaults, canonical format, and generated agents. |

Exit codes: `0` success; `1` validation, conflict, or reference failure, or a refused write; `3` discovery finished with at least one provider failure; `64` usage error.

Operators do not run this command. Membership reaches them through the plugin release (see [Publish through the shared catalog](#publish-through-the-shared-catalog)).

### Discover what providers advertise

```shell
pstack-models discover [--provider <claude|codex|cursor|grok>]... [--json] [--output <file>] [--timeout <seconds>]
```

Discovery queries all four providers by default. `--provider` filters and may repeat. Each adapter uses the CLI's existing authentication and one read-only listing request. It sends zero model turns. It never edits the catalog, role defaults, or user configuration.

| Provider | Method |
| --- | --- |
| `claude` | `claude auth status --json`, then one `initialize` control request over stream-json; rows come from `response.models[]` |
| `codex` | `codex login status`, then `codex app-server` JSON-RPC `model/list`, paged until `nextCursor` is null |
| `cursor` | `cursor-agent models` |
| `grok` | `grok models` |

Output is human-readable by default. `--json` prints the inventory JSON. `--output <file>` writes the JSON to a new file and refuses to overwrite an existing one.

Per-provider status is `ok`, `unavailable-cli` (executable not found), `unauthenticated`, or `failed` (malformed or incomplete response, with the evidence). A provider failure never discards other providers' entries. The inventory's `complete` flag is `true` only when every requested provider is `ok`. Otherwise the command exits `3` and still prints or writes the inventory.

There is no implicit timeout. Pass `--timeout` only when a real bound exists.

### Inventory is evidence, catalog is authority

The inventory records what providers advertised at one moment: provider ids, display names, efforts when the provider reports them, default effort when reported, hidden and default flags, variants, and an advertised resolution when Claude reports `resolvedModel`. Fields the provider does not report stay `null`. Discovery never guesses an effort list.

Each entry carries a `descriptor` and a `membership`. The descriptor is `supported`, with the selector and composition rule that reproduce the provider id, or unsupported, with the reason. The membership is the matching catalog offering or `null`. Only a cataloged member yields copyable descriptors. A discovery-only entry is visible and is not selectable until `pstack-models add` catalogs it. A sheet row that guesses a replacement selector for it fails validation.

### List the catalog with resolution evidence

```shell
pstack-models list [--json] [--from <inventory.json>] [--receipt <runner-receipt.json>]...
```

`list` prints catalog membership grouped by family. Each offering shows its label, `provider:selector`, supported efforts in catalog order, default effort, deprecated and successor state, the rolling-alias flag, and a copyable `provider:selector@effort` value for every supported effort.

Resolution evidence names the concrete revision behind a rolling alias. `list` prints it in one of three forms and never invents one.

| Evidence | Printed when | Meaning |
| --- | --- | --- |
| unknown | no `--from` inventory or `--receipt` covers the offering | `advertised resolution: unknown (no inventory supplied)` |
| advertised | the `--from` inventory has `resolution.resolvedModel` for the `(provider, selector)` | Claude's initialize response named this revision at the inventory's `source.method` and `source.at` |
| observed | a `--receipt` runner receipt matches the `(provider, selector)` | `observed at execution: <reportedModel> (<completedAt>)`, the revision the provider reported during a real run |

### Add, edit, and remove offerings

```shell
pstack-models add <provider:selector> [--from <inventory.json>] [field flags] [--yes]
pstack-models edit <offering-id> [field flags] [--yes]
pstack-models remove <offering-id> [--yes]
```

Field flags for `add` and `edit`: `--id <slug>`, `--family <slug>`, `--display-name <text>`, `--efforts <a,b,c>` (ordered), `--default-effort <effort>`, `--composition <effort-flag|effort-suffix>`, `--native-agent-stem <stem>`, `--native-agent-title <text>`, `--rolling-alias` / `--no-rolling-alias`, `--deprecated` / `--no-deprecated`, `--successor <offering-id>`, `--notes <text>`.

Every mutation follows the same path:

1. Build the complete proposed catalog and every affected generated Claude agent file in memory.
2. Validate the proposal with the parser the runner uses, then validate the current `role-defaults.json` against the proposed catalog.
3. Print a unified diff of `models.json` plus each added, removed, or changed agent file.
4. Require `y` on a TTY or `--yes`. Without either, refuse and exit `1`.
5. Snapshot every target's current bytes, write, read back, and compare. On any failure restore every original byte, delete files that did not exist, and report.

`models.json` is written in the checked-in canonical format, so a membership change diffs as one entry. `add` and `edit` regenerate the Claude-native agent files under `plugins/pstack/agents/` as part of the same write.

`add` builds the proposal from `--from <inventory.json>` when given. The inventory entry must be `supported`. An unsupported or unrepresentable entry cannot be added, and `add` does not guess a selector for it. Selector, composition, efforts, default effort, and display name come from the entry when present. `notes` records `Discovered via <method> on <at>.` Provider adapters fill the rest. A Claude offering gets `effort-flag` composition plus a proposed native agent stem and title. Codex and Grok offerings get `effort-flag`. A Cursor offering gets `effort-suffix`. The proposed `id` is `<provider>-<selector slug>`. Required fields absent from both discovery and flags (`family`, `displayName`, `supportedEfforts`, `defaultEffort`) are prompted on a TTY. Without a TTY the command fails and names them.

Re-adding an entry identical to an existing offering is a no-op (exit `0` with a message). The same `provider:selector` with different fields, or a different `provider:selector` that reuses an existing `id` or `nativeAgentStem`, fails and points at `edit <offering-id>`.

`edit` applies the flag patch. On a TTY it prompts for each field with the current value, and empty input keeps it. Without a TTY it requires at least one flag.

`remove` refuses when `role-defaults.json` references the offering (it names the role ids and lane indexes), when another offering's `successorId` references it, or when a `legacyMigrations[].targetOfferingId` references it. It never rewrites role assignments. Move the roles in a separate change first, then remove.

Deprecate an offering with `edit <offering-id> --deprecated --successor <offering-id>`. Deprecated offerings still validate and dispatch so existing sheets keep working. Setup warns and shows the successor.

### Validate the shipped tree

```shell
pstack-models validate [--json]
```

`validate` parses the catalog and role defaults, checks that every `plugins/pstack/agents/pstack-*.md` file matches the catalog exactly (no extra, missing, or changed files), and checks that `models.json` is in canonical format. It never writes. `--json` prints `{ ok, problems }`. Run it before opening a catalog PR. The Bun tests assert the same invariants.

### Worked example: adding GPT-6 Astra

Codex advertises `gpt-6-astra` with efforts `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`, default `medium`.

1. Record the evidence.

   ```shell
   pstack-models discover --provider codex --output /tmp/inventory.json
   ```

   The Codex section lists `gpt-6-astra` with its efforts, its default, and `membership: not cataloged`.

2. Propose the offering from that evidence.

   ```shell
   pstack-models add codex:gpt-6-astra --from /tmp/inventory.json --family astra
   ```

   The command proposes `id` `codex-gpt-6-astra`, `selectorComposition` `effort-flag`, the six efforts in the advertised order, default `medium`, display name `GPT-6 Astra`, and a `notes` line naming the discovery method and time. Codex does not advertise a family, so `--family` supplies it. Without the flag a TTY session prompts for it.

3. Review the unified diff of `models.json`. No agent files change because a Codex offering has no Claude-native agent.

4. Confirm with `y`.

5. Run `pstack-models validate`, then `bun test runner` in `plugins/pstack/skills/poteto-mode/scripts`.

6. Open the catalog PR (see [Publish through the shared catalog](#publish-through-the-shared-catalog)). After the plugin release, operators can select `codex:gpt-6-astra@ultra` or any other listed effort in setup or in a hand-edited sheet.

### Rolling aliases versus explicit pins

Claude serves rolling aliases such as `fable` and `opus`. The alias name stays fixed while Claude moves it to newer revisions. The catalog marks those offerings `rollingAlias: true`, gives them a display name without a revision number (`Fable`, `Opus`), and labels them "(rolling alias)" in setup, `list`, and discovery output. The catalog never records which revision an alias serves. That fact is evidence with a source and a time.

| Evidence | Source | Meaning |
| --- | --- | --- |
| advertised resolution | discovery, from the Claude initialize response's `resolvedModel` | the revision Claude said the alias resolved to when discovery ran |
| observed at execution | a runner receipt's `reportedModel` | the revision Claude served during a real run |
| unknown | neither supplied | no claim |

An explicit Claude version is a separate offering with its own selector. This release catalogs `claude:claude-fable-5-1[1m]`, display name `Fable 5.1`, with the `[1m]` context modifier passed to Claude unchanged and native agent stem `fable-5-1-1m`. An operator who wants a fixed revision selects that offering. An operator who wants Claude's current Fable selects `claude:fable`.

The two are never rewritten into each other. A sheet that names `claude:fable` keeps the alias. A sheet that names `claude:claude-fable-5-1[1m]` keeps the pin. Only uncataloged predecessor pins that match a `legacyMigrations` pattern migrate, and only to the rolling alias.

A selector may carry one bracketed modifier. It stays in the selector through the sheet, argv, and native-agent generation. Report verification strips it from both the requested selector and the reported model before comparing, and still rejects a different concrete version.

### Supported versus unsupported variants

A discovery entry is `supported` when its provider id can be reproduced exactly from a catalog selector plus the offering's composition rule. Claude, Codex, and Grok ids are selectors as-is (`effort-flag`). Cursor lists composed `<selector>-<effort>` ids (`effort-suffix`). Discovery splits a Cursor id at its last `-` and recognizes the suffix only when it is an effort some catalog offering already declares. Matching ids are grouped under their stem with the recognized efforts. Any other id is reported unsupported under its original id with the reason.

Example: with the shipped catalog, `claude-fable-5-1-ultra` from `cursor-agent models` is reported as an unsupported variant because no offering declares `ultra`. Discovery does not guess that `ultra` is an effort tier. Declare it explicitly.

```shell
pstack-models edit cursor-fable-5-1 --efforts low,medium,high,xhigh,max,ultra
```

After that edit, discovery recognizes the id. The effort vocabulary is the union of every offering's list, so once any offering declares `ultra`, Cursor discovery recognizes a `-ultra` suffix on other stems too. Membership and copyable descriptors still require that stem's own offering to list the effort.

A hand-written descriptor goes through the same binding. `cursor:claude-fable-5-1@ultra` fails validation until the `cursor-fable-5-1` offering lists `ultra`.

### Catalog-defined efforts

Each offering declares `supportedEfforts` as an ordered list of safe identifiers (`^[a-z][a-z0-9-]*$`) and a `defaultEffort` that must appear in the list. There is no global effort enum. The order is preserved everywhere it is shown.

| Offering | Efforts | Default |
| --- | --- | --- |
| `claude:fable` | `low`, `medium`, `high`, `xhigh`, `max` | `max` |
| `cursor:cursor-grok-4.6` | `low`, `medium`, `high`, `xhigh` | `xhigh` |
| `codex:gpt-6-astra` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | `medium` |

An effort outside the bound offering's list fails at every layer with no substitution. Sheet validation and setup reject the row. The runner rejects the `(provider, model, effort)` tuple before preflight. A Claude-native agent file exists only for listed efforts, so an unlisted effort has no agent to dispatch. Nothing rounds `ultra` down to `max` or `max` up to `ultra`.

### Publish through the shared catalog

The catalog ships inside the plugin. There is no personal overlay, environment override, or second configuration file. A membership change reaches operators through the shared plugin release:

1. Run `discover`, `add`, `edit`, or `remove` in a checkout.
2. Run `pstack-models validate` and the Bun tests.
3. Open a PR to this repository that names its Linear issue. Update `CHANGES.md` and `NOTICE.md` as the change requires. Do not edit Arena, Architect, How, Interrogate, setup control flow, or runner provider switch cases. Those read the catalog.
4. After merge, cut the plugin release. Operators receive the new membership when they update the plugin.

Removal affects downstream sheets. `remove` refuses while `role-defaults.json` references the offering, but an operator's sheet may still name a removed offering. That sheet fails validation on the next parent run and the operator must pick a cataloged replacement. Deprecate with a successor first so setup warns and shows the replacement while the offering still dispatches, ship that release, then remove in a later one.
