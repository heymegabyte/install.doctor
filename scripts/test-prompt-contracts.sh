#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

python3 - "$ROOT" <<'PY'
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
prompt = (root / "prompts/bash.md").read_text()
source = (root / "prompts/source.sh").read_text()
docs = (root / "docs/PROMPT.md").read_text()

references = set(re.findall(r"\b(se_[A-Za-z][A-Za-z0-9_]*)\b", prompt))
definitions = set(re.findall(r"^\s*(se_[A-Za-z][A-Za-z0-9_]*)\s*\(\)", source, re.MULTILINE))
missing = sorted(references - definitions)
if missing:
    raise SystemExit("FAIL prompt names undefined source.sh helpers: " + ", ".join(missing))
if "se_*" not in docs or "separate" not in docs.lower() or "provisioning scripts" not in docs:
    raise SystemExit("FAIL docs/PROMPT.md does not separate se_* from provisioning logging")
print(f"PASS prompt helper contract: {len(references)} referenced se_* functions are defined")
print("PASS logging conventions are explicitly scoped")
PY
