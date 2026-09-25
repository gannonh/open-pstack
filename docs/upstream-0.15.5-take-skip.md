# Cursor pstack 0.15.5 take vs skip

Compared `71ed0d1076fec562c1b74ee353121a8d00f75382` (UPSTREAM.md 0.15.0) to the last `pstack/` commit on `cursor/main`, `12d587dfb20741cafc376c42c696c5f6e2a64487` (plugin.json `0.15.5`). The `cursor/main` tip at fetch was `78f46dacbafc71fd7d937bfc2c26da914f1bc09b`. It added no later `pstack/` commits.

Replay:

```shell
git fetch https://github.com/cursor/plugins.git main
git log --oneline 71ed0d1076fec562c1b74ee353121a8d00f75382..FETCH_HEAD -- pstack
python3 scripts/merge-cursor-pstack.py 71ed0d1076fec562c1b74ee353121a8d00f75382 12d587dfb20741cafc376c42c696c5f6e2a64487 0.15.5
```

Eight commits, 45 paths, +137/−157. The merge report is [upstream-0.15.5-merge-report.tsv](upstream-0.15.5-merge-report.tsv).

| Commit | Summary | Decision |
| --- | --- | --- |
| `f8abedd` | Poteto-mode reply rule. Every claim carries its evidence or its label. | Take. |
| `f5bdd68` | Operator-neutral pronouns in autopilot-full, autopilot-stack, and multi-phase-plan. The audit tick posts status in chat. | Take. |
| `889ec4b` | `bug-fix`, `perf-issue`, and `hillclimb` default to Grok 4.6. | Skip. Standing exclusion for those roles. |
| `5bf2b15` | Setup-pstack asks for a budget and records a `# budget` line. | Adapt. See below. |
| `70b2dc8` | Skill port. Opus 5.5 and Grok 4.7 defaults, autopilot verification rounds, merge-prep CI wait, instruction cuts, upgrade help. | Take the prose and playbook changes. Skip the default slugs. |
| `b42effe` | Scrub old model names from public upgrade help. | Take into `README-UPSTREAM.md`. `docs/guide/` stays excluded. |
| `b0b9c7a` | Cut 19 instructions Opus 5.5 does not need. | Take. |
| `12d587d` | Autopilot rule conflicts, one way to read the model rule, plan live lanes on `swarm workers`, setup drops retired role lines. | Take the playbook changes and retired-role drop. Adapt the model-rule reading. |

## Adaptations

**Budget.** Upstream rewrites the effort token inside Cursor `Task` slugs and clamps to a detected slug. Open Pstack descriptors carry effort as `@<effort>`. So setup step 4 sets each offering lane's effort to the budget target, or to that offering's highest `supportedEfforts` entry below it on `low` < `medium` < `high` < `xhigh` < `max` < `ultra`. A role still on its role-defaults offerings restarts from the default efforts, so `unlimited` on a rerun restores them. A role the operator moved keeps its offerings. The `# budget:` line sits under the sheet title, where `parseSheet` keeps it in the preamble.

**Retired roles.** Upstream drops a line for a role that step 5 no longer lists. Open Pstack names the retired ids in `RETIRED_ROLE_IDS` (`sheet.ts`). `parseSheet` reports them as `retired role:` instead of `unknown role:`. Setup drops those rows and lists them at confirmation. Any other unknown row still stops setup.

**Reading the model rule.** Upstream gives each routed skill the same paragraph. The paragraph reads a `pstack-models.mdc` line, uses a Cursor slug default, and falls back to the closest valid `Task` slug. Open Pstack already routes every skill through `provider-dispatch.md` with no fallback. The take is naming the exact role id in each skill: `why investigators`, `why synthesizer`, `reflect tooling`, `reflect judgment, divergent, synthesizer`, and the code playbook roles in poteto-mode.

**Interrogate reviewer count.** Upstream shrinks the default panel to three reviewers. Open Pstack takes the panel size from the `interrogate reviewers` role, so the default stays whatever `catalog/role-defaults.json` lists.

## Skip (standing exclusions, unchanged)

| Path or hunk | Reason |
| --- | --- |
| `pstack/docs/guide/**` | Cursor tutorial. Never ported. |
| `pstack/.cursor-plugin/plugin.json` version `0.15.0`→`0.15.5` | Cursor and Open Pstack versions stay independent. |
| Default model slugs (`grok-4.7-xhigh-fast`, `claude-opus-5-5-max`) | Role defaults live in `catalog/role-defaults.json`. |
| `bug-fix`, `perf-issue`, `hillclimb` default changes | Those roles stay on `codex:gpt-5.6-sol@max`. |
| `disable-model-invocation` on `how`, `why`, `unslop`, `typescript-best-practices` | Not in this delta. |
| `make-bot-ui`, Claude manifest `logo` | Not in this delta. |

No new standing exclusion. The Cursor `Task`-slug fallback wording is now listed in `UPSTREAM.md` next to the default-model exclusion, because every sync meets it.
