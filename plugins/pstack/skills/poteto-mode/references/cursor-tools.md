# Cursor tool mapping for pstack

pstack skills retain Claude Code tool language (`Skill`, `Agent`, `AskUserQuestion`) in shared prose. In Cursor the files are the same; only those tool names resolve differently. Upstream pstack was written for Cursor, so most names return to their originals. Model execution is not translated here. Read [`provider-dispatch.md`](provider-dispatch.md) for the parent-owned route table, where Cursor is a parent harness and `cursor:*` is its native provider.

## Plugin identity

The Cursor plugin is `open-pstack`. It selects the shared `skills/` tree, the `poteto-agent` and `comment-sicko` agents, and the `rules/open-pstack.mdc` startup rule from the same plugin root the Claude Code and Codex `pstack` plugins use. Cursor exposes plugin skills by their directory name with no namespace prefix. Where a skill says `pstack:<name>` or `/pstack:<name>`, invoke the plugin skill `<name>`.

Cursor's original `pstack` plugin ships skills with the same names. Disable it while `open-pstack` is enabled so one workflow instruction set is loaded, and so `/poteto-mode` resolves to one skill. Open PStack never reads, migrates, overwrites, or deletes the original plugin's `~/.cursor/rules/pstack-models.mdc`.

## Tool actions

| pstack / Claude action | Cursor equivalent |
|------------------------|-------------------|
| Read a file | `Read` |
| Create / edit / delete a file | `Write`, `StrReplace`, `Delete` |
| Run a shell command | `Shell` |
| Search file contents / find files | `Grep`, `Glob` |
| Fetch a URL / search the web | `WebFetch`, `WebSearch` |
| Invoke a skill (the `Skill` tool, `/pstack:<name>`) | Skills load natively. Invoke the plugin skill `<name>` by name or `/<name>` and follow the instructions presented. |
| `paths` frontmatter scopes automatic loading | Claude Code only. In Cursor, invoke `typescript-best-practices` by name. |
| Dispatch a subagent (the `Agent`/`Task` tool) | `Task` with `subagent_type`, `prompt`, optional `model`, and `run_in_background` |
| Dispatch N parallel subagents in one turn | N `Task` calls in one message |
| Wait for a subagent result | A foreground `Task` returns its result. A background `Task` reports completion at the end of the turn; `resume` continues a finished subagent with its context. |
| Track tasks (the todolist / `TodoWrite`) | `TodoWrite` |
| Ask the human a fixed-choice question (`AskUserQuestion`) | `AskQuestion` in the IDE. The CLI in print mode has no question tool; ask in plain text and let the user answer. |
| Run a long command as resumable background work | `Shell` with `block_until_ms: 0` in a tmux-backed session, then `AwaitShell` on the returned shell id |

## Subagent policy

poteto-mode's Subagents section sets Claude-specific defaults (`subagent_type: "poteto-agent"`, `run_in_background: true`). In Cursor:

- `poteto-agent` and `comment-sicko` are plugin agents and valid `subagent_type` values. `run_in_background: true` is a `Task` parameter.
- The `pstack-<stem>-<effort>` agent files are Claude-native lanes. The Cursor manifest does not select them. A native Cursor lane pins its model through the `Task` tool's `model` parameter instead (see below).
- The `Task` tool exposes no per-call read-only flag. State the access mode in the prompt. A read-only native participant that edits files is a dropout; record it.
- Isolation is the parent's job. Create a dedicated worktree (`git worktree add`) or unique output directory for every writer and name it in the prompt. Never route a writer into the primary checkout.
- Keep the rest of the policy unchanged. Pass file pointers not inlined context, review every subagent's diff yourself.

## Native Cursor lanes

A `cursor:<selector>@<effort>` descriptor runs natively in a Cursor parent. Compose the `Task` `model` value exactly as the runner composes the CLI id for an `effort-suffix` offering: `<selector>-<effort>` (for example `cursor:cursor-grok-4.6@xhigh` becomes `model: "cursor-grok-4.6-xhigh"`). Use `subagent_type: "generalPurpose"` unless the calling skill names one, `run_in_background: true`, and put the complete task, grounding paths, access mode, and unique output location in the prompt. Retain the task handle and drain it only after fan-out.

Preflight the exact composed id before dispatch: it must appear in the `Task` tool's own allowed model list. The tool description enumerates that list, and a rejected dispatch repeats it in its error. `cursor-agent models` is not the proof for a native lane; it lists the print-mode ids the external runner passes to `cursor-agent -p --model`, and the `Task` list is a shorter, separately curated set (eight slugs in CLI 2026.09.02, varying between sessions; it may or may not contain the catalog default `cursor-grok-4.6-xhigh`). An id absent from the `Task` list is an `unavailable-model` dropout before the lane starts. Never reroute it through the external runner, which rejects the parent's own provider, and never pick a listed neighbour such as a `-fast` variant in its place.

Cursor documents that a configured subagent model can be replaced under team admin restrictions, plan limitations, or a legacy Max Mode setting. The requested model is therefore not proof of the served model. Ask each native lane to write its output to the unique location, then compare the run's exposed execution evidence (the `Task` result metadata and the subagent transcript under `~/.cursor/projects/<slug>/agent-transcripts/<agentId>/`) with the requested id. An observed mismatch is a dropout. A model's own statement about its identity is not evidence, and unverified output cannot count as verification.

In CLI 2026.09.02 the `Task` result carries `agentId`, `isBackground`, and `durationMs`, and neither it nor the transcript names the served model. When no served-model field is exposed, record the native lane with `reportedModel: null`, `modelVerified: false`, and `modelEvidence: "pinned-dispatch"`: the exact slug was accepted at dispatch and a wrong slug is rejected, but Cursor may still substitute silently, so panel synthesis treats the lane as a dropout. Never write `provider-report` or `modelVerified: true` for a native Cursor lane unless Cursor exposed the served model and it matched.

`inherit-parent` and `auto` omit `model` (or pass `model: "inherit"`). The subagent runs on the parent's model and inherits the parent's tools, including MCP tools from configured servers. Keep MCP-dependent Why and Reflect roles on those aliases.

## Models and providers

Do not replace every configured entry with a Cursor model. `/setup-pstack` writes portable `provider:model@effort` descriptors from the catalog to `~/.cursor/rules/open-pstack-models.mdc`. In a Cursor parent, only `cursor:*` is native. Route `claude:*`, `codex:*`, and `grok:*` descriptors through the external launcher with `--parent cursor`, exactly as `provider-dispatch.md` specifies. The launcher rejects `--provider cursor` from a Cursor parent because that lane belongs on the native `Task` route. The catalog default panel keeps multi-provider frontier diversity; do not substitute a Cursor model for a missing external lane.

## Claude built-in skills pstack references

Some triggers name skills that ship with Claude Code, not pstack. In Cursor, substitute the behavior:

| Claude built-in named in pstack | In Cursor |
|---------------------------------|-----------|
| `run` (drive a CLI/TUI to see a change work) | The `control-cli` skill when `cursor-team-kit` is installed; otherwise run the app yourself through `Shell` (tmux for interactive programs) and observe the real output. |
| `verify` (drive a UI to confirm a fix) | The `control-ui` skill when `cursor-team-kit` is installed, or the Browser subagent and browser MCP tools; otherwise hand the user a concrete manual check. Do not claim done without observing the artifact. |
| `plugin-dev:skill-development` (Claude's SKILL.md authoring guidance) | Cursor's built-in `create-skill` skill. Keep `name` + `description` frontmatter and progressive disclosure. |
| `loop` (recurring/self-paced re-invocation, used by `babysit`) | Cursor's built-in `loop` skill (`/loop`). |

## Vendored scripts

`skills/poteto-mode/scripts/` ships the `watch-pr` PR watcher, the `orch` store CLI, `worktree-audit.sh`, `runner/pstack-runner`, and `runner/pstack-models`. They are plain bun and bash, so they run the same in Cursor; invoke them through `Shell`. The external runner additionally needs the assigned `claude`, `codex`, or `grok` executable already authenticated. The other scripts need `bun`, `gh`, (for stack work) `gt`, and (for `worktree-audit.sh`) `jq` and `rg`. `worktree-audit.sh` reads Claude Code transcripts under `~/.claude/projects/`; point it at `~/.cursor/projects/<slug>/agent-transcripts/` when you run it from Cursor.

## Instructions file

Where a pstack skill says "your instructions file", in Cursor that is `AGENTS.md` at the project root plus the rules under `.cursor/rules/` (project) and `~/.cursor/rules/` (user). On Claude Code it is `CLAUDE.md`; on Codex it is `AGENTS.md`.

Where a skill names Claude Code transcripts (`~/.claude/projects/<encoded-cwd>/*.jsonl`), Cursor keeps them at `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`.
