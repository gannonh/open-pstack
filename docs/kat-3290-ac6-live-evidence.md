# KAT-3290 AC6 live harness evidence

Residual proof after #9 and #10 merged to `main` at `75d0c18`. AC 1 through 5 already landed. This note records AC 6 only.

## Install

| Harness | Result |
| --- | --- |
| Cursor CLI 2026.09.02 | Marketplace `open-pstack` re-indexed. Session loaded plugin 1.6.1 from `--plugin-dir /tmp/kat-3290-open-pstack-1.6.1` (copy of `plugins/pstack` at `75d0c18`) and read `~/.cursor/plugins/cache/gannonh-open-pstack/open-pstack/75d0c184b3429678f4c2d1b9f3f0481acfc0d2cd/.cursor-plugin/plugin.json`. |
| Claude Code 2.1.261 | `claude plugin marketplace add gannonh/open-pstack` then `claude plugin install pstack@open-pstack -y -s user`. `claude plugin list` reports `pstack@open-pstack` version 1.6.1, enabled. Print session failed with `Not logged in`. |
| Codex 0.153.4 | `codex plugin marketplace upgrade open-pstack` then `codex plugin add pstack@open-pstack`. List reports `pstack@open-pstack` version 1.6.1, enabled. No live `/setup-pstack` run in this pass. |

The Cursor IDE cloud-plugin manifest still points enabled `open-pstack` at `45a85aec` (1.6.0 with combined Why/Reflect ids). The live check used the 1.6.1 candidate, not that stale enablement.

## Action

Cursor `cursor-agent --print --trust --force --sandbox disabled --workspace /tmp/kat-3290-ac6-cursor --plugin-dir /tmp/kat-3290-open-pstack-1.6.1`.

Prompt asked the session to follow `/setup-pstack` load plus first-run render only. No probes. No write to `~/.cursor/rules/open-pstack-models.mdc`. No touch of `~/.cursor/rules/pstack-models.mdc`.

The session wrote `first-run-sheet.txt` and `ac6-report.md` in that workspace. A copy of the sheet is [kat-3290-ac6-first-run-sheet.txt](kat-3290-ac6-first-run-sheet.txt).

## Observed result

Version 1.6.1. Surface Cursor CLI. The first-run sheet contains these four lines in order, between `how critics` and `arena runners`:

```text
why investigators: inherit-parent
why synthesizer: inherit-parent
reflect tooling: inherit-parent
reflect judgment, divergent, synthesizer: inherit-parent
```

Combined ids `why investigators, synthesizer` and `reflect tooling, judgment, divergent, synthesizer` are absent.

`bun` `firstRunSheet()` from `main` at `75d0c18` is byte-identical to the live sheet (1323 bytes).

## Limits

Claude Code install is 1.6.1 and enabled, but the print session could not log in. Codex install is 1.6.1 and enabled, with no live render in this pass. No operator sheet was written. This is first-run render evidence, which AC 6 allows.
