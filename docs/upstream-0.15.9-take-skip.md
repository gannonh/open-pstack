# Cursor pstack 0.15.9 take vs skip

Compared `12d587dfb20741cafc376c42c696c5f6e2a64487` (UPSTREAM.md 0.15.5) to the last `pstack/` commit on `cursor/main`, `e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a` (plugin.json `0.15.9`). That commit was also the `cursor/main` tip at fetch.

Replay:

```shell
git fetch https://github.com/cursor/plugins.git main
git log --oneline 12d587dfb20741cafc376c42c696c5f6e2a64487..FETCH_HEAD -- pstack
python3 scripts/merge-cursor-pstack.py 12d587dfb20741cafc376c42c696c5f6e2a64487 e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a 0.15.9
```

Four commits, 21 paths, +199/−67. The merge report is [upstream-0.15.9-merge-report.tsv](upstream-0.15.9-merge-report.tsv). It lists 8 conflicts, all resolved by hand as described below.

| Commit | Summary | Decision |
| --- | --- | --- |
| `23e4138` | `principle-explain-the-number` and `benchmark-checklist`, fresh subagents by default, plain-words AskQuestion alternatives, hourly `/loop 1h` audit tick with no `/goal`, push after every verifiable unit, merge-prep `merge-tree` check, PR `##` headings and built-in PR tool rule, swarm respawn, technical-writing source cuts, schema-first Zod example. | Take. Adapt the frontmatter, the tick, and merge prep. See below. |
| `9511e60` | `/correct` skill. | Take. Drop `disable-model-invocation`. |
| `a586282` | Architect judges candidates as an agent contributor would change them, plus four design red flags. | Take. |
| `e43c7ee` | Perf-issue step 2 uses the seven performance mantras. Hillclimb step 4 borrows only their order. | Take. Keep our provider-dispatch wording in perf-issue step 3. |

## Adaptations

**New skill frontmatter.** `benchmark-checklist` and `correct` arrive with `disable-model-invocation: true`. No other non-principle skill in the tree carries that flag, and it blocks poteto-mode's by-name route to `benchmark-checklist` on Claude Code. Both drop it. `principle-explain-the-number` gets `user-invocable: false` from the merge script, like every principle leaf.

**Audit tick and `/goal`.** Upstream drops `/goal` and arms `/loop 1h`. Open Pstack never had `/goal`. Its autopilots wrote the program objective into the standing orders instead. That stand-in goes too. Autopilot-full step 6 and autopilot-stack step 2 arm `/loop 1h`. The multi-phase-plan skeleton says "arm the hourly audit tick as a real cadence" because the copied plan must stay free of harness-private strings (`check-plan.test.ts` forbids `/loop` in the fence). The playbook body maps it to `/loop 1h` on Claude Code and to `codex-tools.md` on Codex. `check-plan.mjs` program markers drop `standing orders` and swap `30-minute` for `hourly`. Upstream drops `/goal` and the 30-minute regex from its markers in the same way.

**Stuck test.** Upstream's tick still judges stuck lanes by expected runtime. Ours stands a lane down only on affirmative failure evidence. That rule stays. The new upstream sentence fits it: the tick judges an owner by its pushed branch and decision trail and replaces an owner whose agent cannot start a turn.

**Merge prep.** Upstream checks `git merge-tree` and the trunk-changed paths against `origin/main`. Ours never assumes a remote named `origin`, so the check fetches trunk through `<base-remote>` and diffs against `$base_remote/main`. The check sits before our Shipping step 5 expected-head landing.

**Opening a PR.** Take the description rewrite and the built-in PR tool paragraph. Keep our fork-PR `gh api` path, `--repo "$base_repo"`, and the repository draft rule. The built-in tool's `draft: false` default yields to that draft rule.

**Review fixes.** `benchmark-checklist` lets a one-run ballpark skip the range and limiter, but its Report section required both. The Report section now gives the one-run format and scopes the inconclusive rule to the full procedure. The built-in PR tool rule also reaches autopilot-stack step 6 and the multi-phase-plan forge line, and the merge-prep drift check diffs against `$base_remote/$trunk`, not `main`.

**AskQuestion.** The plain-words alternatives sentence lands with `AskUserQuestion`, our existing substitution.

## Skip (standing exclusions, unchanged)

| Path or hunk | Reason |
| --- | --- |
| `pstack/docs/guide/**` | Cursor tutorial. Never ported. |
| `pstack/.cursor-plugin/plugin.json` version `0.15.5`→`0.15.9` | Cursor and Open Pstack versions stay independent. |
| Default model slugs in touched hunks | Role defaults live in `catalog/role-defaults.json`. Our playbook lines already read the model sheet. |
| Cursor cloud agent, Bugbot, `control-cli`/`control-ui` wording in touched hunks | Existing Claude Code substitutions in `CHANGES.md` apply. |

`README-UPSTREAM.md` takes upstream's README verbatim, including the `/correct` and `/benchmark-checklist` rows and the principle count change from 23 to 24.

The frontmatter rule for new non-principle skills is now part of the `disable-model-invocation` exclusion in `UPSTREAM.md`.
