# Provider dispatch

pstack model choices are provider-qualified descriptors:

```text
<provider>:<model>@<effort>
```

`inherit-parent` and `auto` remain aliases. They use the parent's current model and effort through its native subagent primitive. In a panel they still consume one lane, but they reduce provider diversity; say so in the synthesis record.

## Catalog

The installed plugin owns two canonical JSON files:

- `catalog/models.json` — supported offerings
- `catalog/role-defaults.json` — first-run role and panel-lane assignments

Read those files. Do not copy model slugs into workflow skills. Do not rewrite a valid cataloged descriptor into another model. Adding an offering for an existing provider is a catalog change; it does not add a runner switch case or a setup family question.

Each offering has a human `displayName` separate from its provider `selector`. Logical Fable 5.1 currently has two offerings: Claude's rolling `fable` selector plus an effort flag, and Cursor's `claude-fable-5-1` stem whose final CLI id includes the effort suffix. Multiple offerings may share a family. Multiple versions may exist on one provider.

Providers stay predefined and adapter-backed: `claude`, `codex`, `cursor`, and `grok`. Arbitrary provider strings are invalid.

An offering also records supported efforts, a default effort, `selectorComposition` (`effort-flag` or `effort-suffix`), and an optional Claude `nativeAgentStem`. Deprecated offerings still validate and dispatch so existing sheets keep working. Setup must warn and show `successorId` when present. Removing an offering is a later catalog PR; sheets that still name it then fail validation with that successor hint. Do not auto-rewrite a deprecated descriptor except through `legacyMigrations` for uncataloged predecessor pins.

## Sheet authority

The parent-specific model sheet is the operator's routing control. A directly edited sheet is valid when every descriptor is `inherit-parent`, `auto`, or a cataloged `provider:selector@effort` whose effort is listed on that offering. Preserve each descriptor verbatim through parsing, setup readback, configuration rendering, and dispatch. Provider, model, and effort are per role and per panel lane. There is no global one-effort-per-family rule. Panel lists are fan-out, not ordered fallback.

If the sheet is absent, use `catalog/role-defaults.json`. Overlay loaded rows onto that complete role map and materialize any missing documented role on the next successful setup write. A duplicate or unknown role is inconsistent state.

## Read-time migration

Look up `(provider, selector)` in the catalog first. A cataloged selector, including an explicit version, is left unchanged even when it looks like a Claude revision slug.

Only uncataloged predecessor pins listed in `legacyMigrations` migrate: a Claude `claude-fable-<digits>` selector becomes the cataloged `fable` offering, and `claude-opus-<digits>` becomes `opus`. Preserve provider, effort, role, and lane order. Record original and migrated descriptors. This in-memory migration does not write user files. Once per parent run, report that `/setup-pstack` will persist it after probes and confirmation.

Unknown descriptors remain invalid. The runner rejects an uncataloged model instead of substituting one.

## The parent owns the route

The top-level harness resolves the route once. A child receives an assigned provider, model, effort, access mode, prompt, working directory, and output path. A child never detects the harness, chooses a provider, or launches another model. Environment markers may corroborate the top-level harness before fan-out, but nested processes inherit parent markers and must not use them for routing.

| Parent | `claude:*` | `codex:*` | `grok:*` | `cursor:*` |
|---|---|---|---|---|
| Claude Code | native `Agent` | external runner | external runner | external runner |
| Codex | external runner | native `spawn_agent` | external runner | external runner |

Native versus external execution is decided by this parent/provider table. The configured catalog selector must survive the route. A hard-coded native-agent default must not override it. Provider-specific transformations are catalog/adapter behavior (Cursor effort suffix versus Claude effort flag), not model substitutions.

## Native lanes

Native dispatch avoids a second CLI startup and its base context.

- Claude Code: look up the descriptor in `catalog/models.json`. Dispatch it through `pstack-<nativeAgentStem>-<effort>` using that offering's stem and the descriptor's effort. Those generated definitions select the catalog selector, requested effort, and `background: true`. `pstack-fable-max` and `pstack-opus-xhigh` remain in that generated set. Pass the complete task, grounding paths, access mode, and unique output location in the `Agent` prompt. Retain the task handle and drain it only after fan-out.
- Codex: call `spawn_agent` with the descriptor's catalog selector and `reasoning_effort`, the complete task, grounding paths, access mode, and unique output location. Use an isolated worktree for a writer. Codex subagents already run concurrently.

Do not send a same-provider descriptor to the external runner. It rejects that call because the native route is cheaper and already available.

Claude rolling aliases (`fable`, `opus`) keep the requested alias in runner receipts as `model` and the concrete provider-reported revision in `reportedModel`. Verification accepts only a numeric `claude-fable-*` or `claude-opus-*` revision from the matching family. A cataloged explicit Claude version is matched as that version, not rewritten to the rolling alias.

## External lanes

The launcher lives at `skills/poteto-mode/scripts/runner/pstack-runner` under the installed plugin. The parent writes the complete candidate prompt to a unique file, creates a unique output directory or worktree, and invokes the launcher directly. Do not put another agent in front of it.

```text
pstack-runner \
  --parent <claude|codex> \
  --provider <claude|codex|grok|cursor> \
  --model <catalog selector> \
  --effort <low|medium|high|xhigh|max> \
  --mode <read-only|isolated-write> \
  --prompt <unique prompt file> \
  --cwd <repository or dedicated worktree> \
  --output <unique final-response file> \
  --receipt <unique receipt file> \
  [--timeout <seconds>]
```

Pass arguments as an argv array or quote every path. Never interpolate prompt text into a shell command. The launcher loads the catalog, requires the `(provider, model, effort)` tuple to be a supported offering, preflights the assigned CLI and authentication, invokes the model exactly once, disables recursive agents and ambient skill dispatch where the CLI supports it, restricts the built-in tool surface, and records the exact provider/model/effort flags. External lanes do not receive the parent's MCP surface. Keep MCP-dependent Why and Reflect roles on `inherit-parent` or `auto`. The launcher never falls back.

For `effort-suffix` offerings the launcher composes `<selector>-<effort>` as the CLI model id. For `effort-flag` offerings it passes the catalog selector and the provider's effort flag. Cursor preflight is the `cursor-agent models` listing: it proves authentication and that the composed id is served, in one command. A listing without that exact id is an `unavailable-model` dropout before the model ever starts.

Grok authentication preflight has one bounded retry. If the first `grok models` result would be classified as unauthenticated, the runner waits five seconds and tries the same preflight once more. A second failure is terminal. The delay and second attempt share the runner's absolute deadline and cancellation latch, and the receipt keeps evidence from both attempts. Model execution is never retried.

The parent tool sandbox still governs whether a subscribed child CLI can reach its credentials and network. Run setup's live probe from the actual parent profile. A blocked external CLI is a loud dropout, not a reason to elevate permissions or substitute a model silently.

The parent invocation must itself be resumable background work:

- Claude Code: call the launcher through a Bash tool invocation with `run_in_background: true` and retain its task ID. A foreground Bash tool call has an automatic ten-minute ceiling even when the runner's own timeout is longer. Shelling out with `&` and losing the task handle is not equivalent.
- Codex: run the launcher in a persistent exec session that returns a session ID, then wait or poll that handle. Do not hold one foreground tool call open for the model's full runtime.

Start the background process, continue launching the other lanes, then drain their handles. Native and external lanes belong in the same fan-out phase.

The runner and its preflight have no implicit timeout. Do not invent a duration from role, mode, or a convenient round number; real implementation lanes can run for 90 minutes or much longer. Pass `--timeout` only when the user, an external service deadline, or a measured task contract supplies a real bound. That value starts at wrapper entry, before module loading and argument parsing, and remains one absolute deadline across setup, preflight, model execution, and output capture. It is never a fresh allowance per child, and long waits are armed in runtime-safe chunks without shortening the supplied deadline. Otherwise supervise liveness through the retained background task/session handle and cancel manually only on evidence that the run is dead. Cancel through that retained handle so the runner receives SIGINT or SIGTERM, sends it to an active child when one remains, stops waiting on inherited output pipes, removes the empty output reservation, and writes a `cancelled` receipt. Preserve that receipt; a retry is a new attempt with new unique output and receipt paths. Unchanged running state is not a dropout, and Claude's ten-minute foreground ceiling is never a reason to terminate a healthy lane.

Read-only mode maps to Claude plan mode with project-only settings and an explicit tool list, Codex's read-only sandbox, Grok plan mode plus its `read-only` sandbox and read-oriented tool list, and Cursor plan mode (`--mode plan`). Grok's built-in read-only profile deliberately keeps its own state and system temporary directories writable, so point a read-only Grok lane at the actual checkout rather than a worktree under `/tmp`, `/var/tmp`, or the host's temporary directory. `isolated-write` maps to Claude `acceptEdits` with project-only settings, Codex `workspace-write`, Grok `acceptEdits` plus its `workspace` sandbox and write-capable tool list, and Cursor `--force` (which is why a Cursor writer must only ever see its dedicated worktree). Cursor exposes no per-run flag to disable configured MCP servers; they stay unapproved because the launcher never passes `--approve-mcps`. Give every writer only a dedicated worktree or output directory. Never route a writer into the primary checkout.

Every concurrent external lane needs distinct prompt, output, and receipt paths. The launcher reserves output and receipt paths exclusively and refuses to overwrite them.

## Completion and dropouts

Success requires all of these:

1. Exit status `0`.
2. Receipt status `complete`.
3. Either `modelVerified: true` with `modelEvidence: "provider-report"`, or a Codex receipt with `reportedModel: null`, `modelVerified: false`, and `modelEvidence: "pinned-argv"`. For Claude rolling aliases, the concrete provider report must belong to the requested family. Codex 0.149.0 accepts the exact `--model` argument but does not report the served model in its JSONL stream.
4. A non-empty output file.

The receipt also carries elapsed time, token usage when the CLI exposes it, and cost when available. Keep it with the arena or review artifacts so parent-harness comparisons are evidence-based.

Any missing CLI, failed login, unavailable model, invalid catalog selection, explicit timeout, cancellation, catchable post-reservation launcher failure, non-zero child exit, malformed result, or model mismatch is a receipt-bearing dropout. Record it and apply the calling skill's existing dropout policy. A `cancelled` receipt proves that the runner received the signal; its `signal` field is non-null only when the runner sent that signal to a still-active direct CLI child, and remains null when cancellation only stopped a post-exit pipe drain. The provider CLI owns any processes it starts beneath that direct child; the receipt does not claim a process-tree kill. Do not delete or overwrite the receipt. Never substitute the parent model, retry another provider, or reinterpret an external descriptor as a native model slug.

Start native and external lanes in the same fan-out phase, then wait for all of them before judging. A judge must not read candidate paths while their owners are still writing.
