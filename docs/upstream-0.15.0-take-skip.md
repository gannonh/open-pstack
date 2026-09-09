# Cursor pstack 0.15.0 take vs skip

Compared `7314f723a487ec406b6369fe5865ba034cfed166` (UPSTREAM.md 0.14.8) to the last `pstack/` commit on `cursor/main`: `71ed0d1076fec562c1b74ee353121a8d00f75382` (plugin.json `0.15.0`). `cursor/main` tip at fetch was `27e2a62ff94f9af4b5e68435e41cdceacadb840c` and did not add later `pstack/` commits.

Replay:

```shell
git fetch cursor main
git log --oneline 7314f723a487ec406b6369fe5865ba034cfed166..cursor/main -- pstack
git diff --stat 7314f723a487ec406b6369fe5865ba034cfed166..cursor/main -- pstack
```

Three commits, 95 paths, +550/−816.

| Commit | Summary | Decision |
| --- | --- | --- |
| `e8d856f` | Density and mannered-prose pass. Adds `principle-attack-the-premise` and `principle-test-behavior-not-implementation`. Removes how critique mode and its two reference files. | Take skill/playbook/principle content. |
| `d7cde2b` | Semicolon, em dash, and connector-colon punctuation in `pstack/skills`. | Take. |
| `71ed0d1` | Version `0.15.0`. README playbook count 22→23. Guide principle-count copy. | Take README into `README-UPSTREAM.md`. Skip version file and `docs/guide/`. |

## Take

- Shared `plugins/pstack/skills/` edits, including the two new principle leaves.
- Deletion of `how/references/critic-prompt.md` and `how/references/critique-rubric.md`.
- Removal of the `how critics` role (critique mode is gone). Catalog, setup examples, and generated sheets follow that deletion.
- `README-UPSTREAM.md` playbook table and counts.

New principles keep the existing principle convention (`user-invocable: false`) instead of upstream `disable-model-invocation: true`.

## Skip (standing exclusions, unchanged)

| Path or hunk | Reason |
| --- | --- |
| `pstack/docs/guide/**` | Cursor tutorial. Never ported. |
| `pstack/.cursor-plugin/plugin.json` version `0.14.8`→`0.15.0` | Cursor version and Open Pstack version stay independent. |
| `disable-model-invocation: true` on `how`, `why`, `unslop`, `typescript-best-practices` | Still present in 0.15.0. Still omitted so poteto-mode can invoke those skills on Claude Code. |
| `make-bot-ui` | Not in this delta. |
| Sol→Fable defaults on `bug-fix` / `perf-issue` / `hillclimb` | Not in this delta. Roles stay `codex:gpt-5.6-sol@max`. |
| Claude manifest `logo` | Not in this delta. |

No new standing exclusion. Removing `how critics` is taking 0.15.0, not a new skip.

## Merge method

`scripts/merge-cursor-pstack.py` 3-way merges each taken path (ancestor `7314f72`, ours = current tree, theirs = `71ed0d1`). Files byte-identical to ancestor take theirs. New principle files are added with the frontmatter swap. Report: `docs/upstream-0.15.0-merge-report.tsv`.
