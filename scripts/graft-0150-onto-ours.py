#!/usr/bin/env python3
"""Restore HEAD copies of conflicted files, then apply ancestor→0.15.0 edits
onto the adapted open-pstack text.

Looks up each upstream hunk after running the mechanical Cursor→open-pstack
substitutions. Unapplied hunks are listed so they can be finished by hand.
"""
from __future__ import annotations

import difflib
import subprocess
from pathlib import Path

REPO = Path("/workspace")
ANCESTOR = "7314f723a487ec406b6369fe5865ba034cfed166"
THEIRS = "71ed0d1076fec562c1b74ee353121a8d00f75382"
OURS_HEAD = Path("/tmp/ours-head")

CONFLICTED = [
    "plugins/pstack/skills/arena/SKILL.md",
    "plugins/pstack/skills/automate-me/SKILL.md",
    "plugins/pstack/skills/how/SKILL.md",
    "plugins/pstack/skills/interrogate/SKILL.md",
    "plugins/pstack/skills/no-comments/SKILL.md",
    "plugins/pstack/skills/poteto-mode/SKILL.md",
    "plugins/pstack/skills/poteto-mode/playbooks/autonomous-run.md",
    "plugins/pstack/skills/poteto-mode/playbooks/autopilot-full.md",
    "plugins/pstack/skills/poteto-mode/playbooks/autopilot-stack.md",
    "plugins/pstack/skills/poteto-mode/playbooks/babysit.md",
    "plugins/pstack/skills/poteto-mode/playbooks/bug-fix.md",
    "plugins/pstack/skills/poteto-mode/playbooks/eval.md",
    "plugins/pstack/skills/poteto-mode/playbooks/feature.md",
    "plugins/pstack/skills/poteto-mode/playbooks/hillclimb.md",
    "plugins/pstack/skills/poteto-mode/playbooks/multi-phase-plan.md",
    "plugins/pstack/skills/poteto-mode/playbooks/opening-a-pr.md",
    "plugins/pstack/skills/poteto-mode/playbooks/orchestrate.md",
    "plugins/pstack/skills/poteto-mode/playbooks/pause-safely.md",
    "plugins/pstack/skills/poteto-mode/playbooks/perf-issue.md",
    "plugins/pstack/skills/poteto-mode/playbooks/prototype.md",
    "plugins/pstack/skills/poteto-mode/playbooks/refactoring.md",
    "plugins/pstack/skills/poteto-mode/playbooks/session-pickup.md",
    "plugins/pstack/skills/poteto-mode/playbooks/shipping.md",
    "plugins/pstack/skills/poteto-mode/playbooks/visual-parity.md",
    "plugins/pstack/skills/poteto-mode/playbooks/worktree-cleanup.md",
    "plugins/pstack/skills/principle-subtract-before-you-add/SKILL.md",
    "plugins/pstack/skills/reflect/SKILL.md",
    "plugins/pstack/skills/setup-pstack/SKILL.md",
    "plugins/pstack/skills/show-me-your-work/SKILL.md",
    "plugins/pstack/skills/swarm/SKILL.md",
    "plugins/pstack/skills/why/SKILL.md",
    "plugins/pstack/skills/why/references/sources/databricks.md",
]


def git_show(rev_path: str) -> str:
    return subprocess.check_output(["git", "show", rev_path], cwd=REPO).decode()


def cursor_path(rel: str) -> str:
    return rel.removeprefix("plugins/")


def adapt(text: str) -> str:
    pairs = [
        ("AskQuestion", "AskUserQuestion"),
        ("`create-skill`", "`plugin-dev:skill-development`"),
        ("Cursor's built-in `plugin-dev:skill-development`", "the `plugin-dev:skill-development` skill"),
        ("the **create-skill** skill (Cursor's built-in for authoring SKILL.md files)", "the **plugin-dev:skill-development** skill (Claude Code's authoring guidance for SKILL.md files)"),
        ("**create-skill** skill (Cursor's built-in for authoring SKILL.md files)", "**plugin-dev:skill-development** skill (Claude Code's authoring guidance for SKILL.md files)"),
        ("from `cursor-team-kit`", ""),
        ("the `deslop` skill from the `cursor-team-kit` plugin", "the **deslop** skill"),
        ("`~/.cursor/rules/pstack-models.mdc`", "the current harness's pstack model sheet"),
        ("in `~/.cursor/rules/pstack-models.mdc`", "in the current harness's pstack model sheet"),
        ("from `~/.cursor/rules/pstack-models.mdc`", "from the current harness's pstack model sheet"),
        ("`subagent_type`: `generalPurpose`", '`subagent_type`: `"general-purpose"`'),
    ]
    for old, new in pairs:
        text = text.replace(old, new)
    return text


def apply_opcodes(working: str, ancestor: str, theirs: str, rel: str) -> list[str]:
    a = ancestor.splitlines(keepends=True)
    b = theirs.splitlines(keepends=True)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    missed: list[str] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        old = adapt("".join(a[i1:i2]))
        new = adapt("".join(b[j1:j2]))
        if tag == "replace":
            if old and old in working:
                working = working.replace(old, new, 1)
            elif new and new in working:
                continue
            else:
                missed.append(f"{rel}:replace:{i1+1}-{i2}")
        elif tag == "delete":
            if old and old in working:
                working = working.replace(old, "", 1)
            else:
                missed.append(f"{rel}:delete:{i1+1}-{i2}")
        elif tag == "insert":
            if new and new in working:
                continue
            # insert after adapted ancestor context line
            if i1 > 0:
                ctx = adapt("".join(a[i1 - 1 : i1]))
                if ctx and ctx in working:
                    working = working.replace(ctx, ctx + new, 1)
                    continue
            missed.append(f"{rel}:insert-after-line-{i1}")
    Path(REPO / rel).write_text(working)
    return missed


def main() -> None:
    missed: list[str] = []
    for rel in CONFLICTED:
        src = OURS_HEAD / rel
        dest = REPO / rel
        dest.write_text(src.read_text())
        ancestor = git_show(f"{ANCESTOR}:{cursor_path(rel)}")
        theirs = git_show(f"{THEIRS}:{cursor_path(rel)}")
        missed.extend(apply_opcodes(dest.read_text(), ancestor, theirs, rel))
    report = REPO / "docs/upstream-0.15.0-graft-missed.txt"
    report.write_text("\n".join(missed) + ("\n" if missed else ""))
    print(f"grafted {len(CONFLICTED)} files; {len(missed)} hunks missed → {report}")
    for row in missed:
        print(row)


if __name__ == "__main__":
    main()
