#!/usr/bin/env python3
"""3-way merge Cursor pstack into plugins/pstack, then report conflicts.

Ancestor: recorded UPSTREAM.md sync commit.
Theirs: Cursor pstack tip that touched pstack/.
Ours: current open-pstack files (Claude/Codex/Cursor adaptations).

Skips docs/guide (Cursor tutorial) and upstream plugin.json (independent versions).
New principle leaves swap disable-model-invocation for user-invocable: false.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ANCESTOR = "7314f723a487ec406b6369fe5865ba034cfed166"
THEIRS = "71ed0d1076fec562c1b74ee353121a8d00f75382"
WORKDIR = Path("/tmp/pstack-0150-merge")

SKIP_PREFIXES = ("pstack/docs/guide/",)
SKIP_EXACT = {"pstack/.cursor-plugin/plugin.json"}


def run(args: list[str], **kwargs) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(args, cwd=REPO, check=True, capture_output=True, **kwargs)


def git_show(rev_path: str) -> bytes:
    return run(["git", "show", rev_path]).stdout


def map_ours(cursor_path: str) -> Path:
    if cursor_path == "pstack/README.md":
        return REPO / "README-UPSTREAM.md"
    return REPO / "plugins" / cursor_path


def write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def principle_frontmatter(data: bytes) -> bytes:
    text = data.decode()
    text = text.replace("disable-model-invocation: true\n", "user-invocable: false\n", 1)
    return text.encode()


def main() -> int:
    WORKDIR.mkdir(parents=True, exist_ok=True)
    status = run(
        ["git", "diff", "--name-status", ANCESTOR, THEIRS, "--", "pstack"]
    ).stdout.decode()
    report: list[str] = []
    conflicts = 0
    for line in status.splitlines():
        st, path = line.split("\t", 1)
        if path in SKIP_EXACT or path.startswith(SKIP_PREFIXES):
            report.append(f"SKIP\t{st}\t{path}")
            continue
        ours = map_ours(path)
        if st == "A":
            data = git_show(f"{THEIRS}:{path}")
            if path.startswith("pstack/skills/principle-"):
                data = principle_frontmatter(data)
            write(ours, data)
            report.append(f"ADD\t{st}\t{ours.relative_to(REPO)}")
            continue
        if st == "D":
            if ours.exists():
                ours.unlink()
                report.append(f"DEL\t{st}\t{ours.relative_to(REPO)}")
            else:
                report.append(f"DEL-MISS\t{st}\t{path}")
            continue
        theirs = git_show(f"{THEIRS}:{path}")
        ancestor = git_show(f"{ANCESTOR}:{path}")
        if not ours.exists():
            write(ours, theirs)
            report.append(f"TAKE-THEIRS-MISSING\t{st}\t{ours.relative_to(REPO)}")
            continue
        ours_bytes = ours.read_bytes()
        if ours_bytes == ancestor:
            write(ours, theirs)
            report.append(f"TAKE-THEIRS\t{st}\t{ours.relative_to(REPO)}")
            continue
        base = WORKDIR / "base"
        current = WORKDIR / "ours"
        other = WORKDIR / "theirs"
        write(base, ancestor)
        write(current, ours_bytes)
        write(other, theirs)
        merged = subprocess.run(
            ["git", "merge-file", "-p", "--diff3", str(current), str(base), str(other)],
            capture_output=True,
        )
        write(ours, merged.stdout)
        if merged.returncode == 0:
            report.append(f"MERGE\t{st}\t{ours.relative_to(REPO)}")
        else:
            conflicts += 1
            report.append(f"CONFLICT\t{st}\t{ours.relative_to(REPO)}")
    out = REPO / "docs" / "upstream-0.15.0-merge-report.tsv"
    out.write_text("result\tstatus\tpath\n" + "\n".join(report) + "\n")
    print(f"wrote {out} ({len(report)} rows, {conflicts} conflicts)")
    for row in report:
        if row.startswith("CONFLICT") or row.startswith("SKIP") or row.startswith("ADD"):
            print(row)
    return 1 if conflicts else 0


if __name__ == "__main__":
    sys.exit(main())
