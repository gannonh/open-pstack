# Upstream synchronization

This repository is `gannonh/open-pstack`. In this repository, "upstream" means Lauren Tan's Cursor pstack. The tree lives at [cursor/plugins `pstack/`](https://github.com/cursor/plugins/tree/main/pstack). Fetch it from the `cursor` remote, path `pstack/`.

Do not name a remote `upstream`. Soft-fork tracking of `ericlitman/open-pstack` ended 2026-09-06. Gannon decided that Cursor pstack is the only content-sync source. `ericlitman/open-pstack` and `michael-denyer/pstack-claude` are historical lineage. An `ericlitman` remote is an optional archive. Never merge from it.

## Add remotes

`git clone https://github.com/gannonh/open-pstack.git` already creates `origin`. Add the remaining remotes once per clone:

```shell
git remote add cursor https://github.com/cursor/plugins.git
# optional archive only; never merge from it
git remote add ericlitman https://github.com/ericlitman/open-pstack.git
```

## Current sync point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/cursor/plugins.git` |
| Path | `pstack/` |
| Commit | `7314f723a487ec406b6369fe5865ba034cfed166` |
| Upstream version | `0.14.8` |
| open-pstack version | `1.6.2` |

The table above is the current Cursor sync point. `README-UPSTREAM.md` preserves its pstack README verbatim. `CHANGES.md` and `NOTICE.md` describe the adaptations and provenance.

## Upstream-only exclusions

- Commits `799151d` and `6fecddb` add and relocate `make-bot-ui`. It depends on Cursor routines, webhook events, and UI primitives that Claude Code and Codex do not share.
- Four `disable-model-invocation: true` lines from `73f8be4` are not applied to `how`, `why`, `unslop`, or `typescript-best-practices`. Poteto-mode invokes those skills by name, and the flag blocks that route on Claude Code.
- The `23a56e2` default-model hunks for `bug-fix`, `perf-issue`, and `hillclimb` are not applied. Those frequent code-writing roles stay on `codex:gpt-5.6-sol@max` for cost.
- The Claude manifest does not take the logo field from `efa2a53` because Claude Code has no schema for it. The shared asset is exposed through the Codex manifest instead.

## Check for changes

The maintainer checkout already has the `cursor` remote. A fresh clone has only `origin`; add `cursor` once as shown in [Add remotes](#add-remotes).

Fetch and inspect only commits that touched pstack after the recorded sync point:

```shell
git fetch cursor main
git log --oneline 7314f723a487ec406b6369fe5865ba034cfed166..cursor/main -- pstack
git diff --stat 7314f723a487ec406b6369fe5865ba034cfed166..cursor/main -- pstack
```

No output means the tracked pstack tree has not changed. This comparison does not need a polling service or generated mirror branch.

## Incorporate a change

1. Create or update the Linear issue that specs the sync. Branch from current `main`. Product work stays in Linear project Open Pstack and in this repository. GitHub Issues are inbound reports only. Do not file product work on `ericlitman/open-pstack`.
2. Read each upstream pstack commit in order. Bring over its intent and content. Then apply only the Claude Code and Codex substitutions documented in `CHANGES.md`.
3. Keep one shared `plugins/pstack/skills/` tree. Put harness translation in the existing `codex-tools.md` and `cursor-tools.md` and provider routing in `provider-dispatch.md`. Do not fork a skill per harness. The Cursor plugin `open-pstack` reads the same tree through `plugins/pstack/.cursor-plugin/plugin.json`.
4. Update the commit and version in this file, the affected provenance rows in `NOTICE.md`, and `README-UPSTREAM.md` when upstream changes it.
5. Run CI-equivalent checks locally, then run the installed behavioral lanes required by the changed surface in every affected harness. Cover Claude Code, Codex, and Cursor when the sync touches shared skills, catalog, dispatch references, or other Cursor-consumed surfaces. Unit tests alone are not a release gate.
6. Merge the reviewed PR before tagging the next Open Pstack release.

Cursor's version and Open Pstack's version are independent. Cursor's version identifies the imported content. Open Pstack's version identifies the three-plugin distribution.
