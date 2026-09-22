# Content upstream

This repository is `gannonh/open-pstack`. Its content upstream is [Cursor's pstack tree](https://github.com/cursor/plugins/tree/main/pstack), in the `cursor/plugins` repository at path `pstack/`. Maintainers review upstream commits and integrate selected changes. This does not require a persistent Git remote or a GitHub fork relationship to Cursor.

Do not name a remote `upstream`. The `origin` remote points to `gannonh/open-pstack`. GitHub's fork metadata is separate from the content source. The project history and attribution are recorded in [NOTICE.md](NOTICE.md) and [CHANGES.md](CHANGES.md).

## Current sync point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/cursor/plugins.git` |
| Path | `pstack/` |
| Commit | `71ed0d1076fec562c1b74ee353121a8d00f75382` |
| Upstream version | `0.15.0` |
| open-pstack version | `1.6.7` |

The table above is the current Cursor sync point. `README-UPSTREAM.md` preserves its pstack README verbatim. `CHANGES.md` and `NOTICE.md` describe the adaptations and provenance. The 0.14.8→0.15.0 take vs skip record is [docs/upstream-0.15.0-take-skip.md](docs/upstream-0.15.0-take-skip.md).

## Upstream-only exclusions

- Commits `799151d` and `6fecddb` add and relocate `make-bot-ui`. It depends on Cursor routines, webhook events, and UI primitives that Claude Code and Codex do not share.
- Four `disable-model-invocation: true` lines from `73f8be4` are not applied to `how`, `why`, `unslop`, or `typescript-best-practices`. Poteto-mode invokes those skills by name, and the flag blocks that route on Claude Code.
- The `23a56e2` default-model hunks for `bug-fix`, `perf-issue`, and `hillclimb` are not applied. Those frequent code-writing roles stay on `codex:gpt-5.6-sol@max` for cost.
- The Claude manifest does not take the logo field from `efa2a53` because Claude Code has no schema for it. The shared asset is exposed through the Codex manifest instead.

## Check for changes

Fetch the Cursor branch directly when you check for changes. This updates `FETCH_HEAD` and does not add a remote to the checkout.

Fetch and inspect only commits that touched pstack after the recorded sync point:

```shell
git fetch https://github.com/cursor/plugins.git main
git log --oneline 71ed0d1076fec562c1b74ee353121a8d00f75382..FETCH_HEAD -- pstack
git diff --stat 71ed0d1076fec562c1b74ee353121a8d00f75382..FETCH_HEAD -- pstack
```

No output means the tracked pstack tree has not changed. This comparison does not need a polling service or generated mirror branch.

## Incorporate a change

1. Create or update the Linear issue that specs the sync. Branch from current `main`. Product work stays in Linear project Open Pstack and in this repository. GitHub Issues are inbound reports only.
2. Read each upstream pstack commit in order. Bring over its intent and content. Then apply only the Claude Code and Codex substitutions documented in `CHANGES.md`.
3. Keep one shared `plugins/pstack/skills/` tree. Put harness translation in the existing `codex-tools.md` and `cursor-tools.md` and provider routing in `provider-dispatch.md`. Do not fork a skill per harness. The Cursor plugin `open-pstack` reads the same tree through `plugins/pstack/.cursor-plugin/plugin.json`.
4. Update the commit and version in this file, the affected provenance rows in `NOTICE.md`, and `README-UPSTREAM.md` when upstream changes it.
5. Run CI-equivalent checks locally, then run the installed behavioral lanes required by the changed surface in every affected harness. Cover Claude Code, Codex, and Cursor when the sync touches shared skills, catalog, dispatch references, or other Cursor-consumed surfaces. Unit tests alone are not a release gate.
6. Merge the reviewed PR before tagging the next Open Pstack release.

Cursor's version and Open Pstack's version are independent. Cursor's version identifies the imported content. Open Pstack's version identifies the three-plugin distribution.
