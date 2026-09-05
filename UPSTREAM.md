# Upstream synchronization

This fork (`gannonh/open-pstack`) tracks [`ericlitman/open-pstack`](https://github.com/ericlitman/open-pstack) as its direct upstream (`git remote add upstream https://github.com/ericlitman/open-pstack.git`), carrying the cursor-provider delta described in `CHANGES.md` (fork entries 1.3.0 and 1.3.1) on top. Fork versions increment past the upstream version they include so the two release lines never share a number. The rest of this file documents how open-pstack itself tracks Lauren's original pstack.

open-pstack tracks [Cursor's pstack](https://github.com/cursor/plugins/tree/main/pstack) while adapting Cursor-specific primitives for Claude Code and Codex.

## Current sync point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/cursor/plugins.git` |
| Path | `pstack/` |
| Commit | `7314f723a487ec406b6369fe5865ba034cfed166` |
| Upstream version | `0.14.8` |
| open-pstack version | `1.4.0` |

The table above is the current Cursor sync point. Fork release 1.3.1 carries the 0.14.8 sync on top of Open Pstack 1.3.0. `README-UPSTREAM.md` preserves its pstack README verbatim. `CHANGES.md` and `NOTICE.md` describe the adaptations and provenance.

## Upstream-only exclusions

- Commits `799151d` and `6fecddb` add and relocate `make-bot-ui`. It depends on Cursor routines, webhook events, and UI primitives that Claude Code and Codex do not share.
- Four `disable-model-invocation: true` lines from `73f8be4` are not applied to `how`, `why`, `unslop`, or `typescript-best-practices`. Poteto-mode invokes those skills by name, and the flag blocks that route on Claude Code.
- The `23a56e2` default-model hunks for `bug-fix`, `perf-issue`, and `hillclimb` are not applied. Those frequent code-writing roles stay on `codex:gpt-5.6-sol@max` for cost.
- The Claude manifest does not take the logo field from `efa2a53` because Claude Code has no schema for it. The shared asset is exposed through the Codex manifest instead.

## Check for changes

The repository already names Cursor's repository as the `cursor` remote in the maintainer checkout. A fresh clone can add it once:

```shell
git remote add cursor https://github.com/cursor/plugins.git
```

Fetch and inspect only commits that touched pstack after the recorded sync point:

```shell
git fetch cursor main
git log --oneline 7314f723a487ec406b6369fe5865ba034cfed166..cursor/main -- pstack
git diff --stat 7314f723a487ec406b6369fe5865ba034cfed166..cursor/main -- pstack
```

No output means the tracked pstack tree has not changed. This comparison does not need a polling service or generated mirror branch.

## Incorporate a change

1. Create or update a GitHub issue (in `gannonh/open-pstack` for fork-delta work, `ericlitman/open-pstack` otherwise) and branch from current `main`.
2. Read each upstream pstack commit in order. Bring over its intent and content, then apply only the Claude Code and Codex substitutions documented in `CHANGES.md`.
3. Keep one shared `plugins/pstack/skills/` tree. Put harness translation in the existing `codex-tools.md` and provider routing in `provider-dispatch.md`; do not fork a skill per harness.
4. Update the commit and version in this file, the affected provenance rows in `NOTICE.md`, and `README-UPSTREAM.md` when upstream changes it.
5. Run CI-equivalent checks locally, then run the installed Claude Code and Codex behavioral lanes required by the changed surface. Unit tests alone are not a release gate.
6. Merge the reviewed PR before tagging the next open-pstack release.

Cursor's version and open-pstack's version are independent. Cursor's version identifies the imported content; open-pstack's version identifies the cross-harness distribution.
