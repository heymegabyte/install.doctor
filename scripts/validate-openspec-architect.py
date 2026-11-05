#!/usr/bin/env python3
"""Reject active OpenSpec architecture without an explicitly assigned frontier architect."""

from __future__ import annotations

import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
CHANGES = ROOT / "openspec" / "changes"
ALLOWED = {"claude", "codex", "antigravity"}
ARCHITECT = re.compile(r"^> \*\*Architect:\*\*\s+([a-z0-9_-]+)\s*$", re.MULTILINE)
ROLE = re.compile(r"^> \*\*Architect Role:\*\*\s+assigned\s*$", re.MULTILINE)


def main() -> int:
    errors: list[str] = []
    for change in sorted(path for path in CHANGES.iterdir() if path.is_dir() and path.name != "archive"):
        for filename in ("proposal.md", "design.md"):
            artifact = change / filename
            if not artifact.exists():
                continue
            content = artifact.read_text(encoding="utf-8")
            match = ARCHITECT.search(content)
            if match is None or match.group(1) not in ALLOWED:
                errors.append(f"{artifact.relative_to(ROOT)}: missing or invalid frontier Architect")
            if ROLE.search(content) is None:
                errors.append(f"{artifact.relative_to(ROOT)}: Architect Role must be assigned")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
