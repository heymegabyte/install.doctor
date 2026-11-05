#!/usr/bin/env python3
"""Build a value-free Infisical workload inventory for the local repository estate."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess


ENV_REFERENCE = re.compile(r"(?:process\.env\.|\$\{|\$)([A-Z][A-Z0-9_]{2,})")
SECRET_SHAPED = re.compile(r"(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_KEY|PRIVATE_KEY|ACCESS_KEY|DSN)$")
EXCLUDED = {"HOME", "PATH", "SHELL", "TERM", "USER", "HOST", "PWD", "CI"}


def tracked_files(repo: pathlib.Path) -> list[pathlib.Path]:
    result = subprocess.run(
        ["git", "-C", str(repo), "ls-files", "-z"], check=True, capture_output=True
    )
    return [repo / item.decode() for item in result.stdout.split(b"\0") if item]


def referenced_secret_names(repo: pathlib.Path) -> list[str]:
    names: set[str] = set()
    result = subprocess.run(
        ["git", "-C", str(repo), "grep", "-I", "-h", "-o", "-E", r"(process\.env\.|\$\{|\$)[A-Z][A-Z0-9_]{2,}"],
        check=False, capture_output=True, text=True, timeout=15,
    )
    for line in result.stdout.splitlines():
        match = ENV_REFERENCE.fullmatch(line.strip())
        if match:
            name = match.group(1)
            if name not in EXCLUDED and SECRET_SHAPED.search(name):
                names.add(name)
    return sorted(names)


def runtime_class(repo: pathlib.Path, files: list[pathlib.Path]) -> str:
    relative = {path.relative_to(repo).as_posix() for path in files}
    if "wrangler.toml" in relative or "wrangler.jsonc" in relative:
        return "cloudflare-worker"
    if any(path.startswith(".github/workflows/") for path in relative):
        return "github-actions"
    if "docker-compose.yml" in relative or "compose.yml" in relative:
        return "container-service"
    if any(path.endswith(".service") for path in relative):
        return "systemd-service"
    return "local-process"


def safe_metadata(path: pathlib.Path, allowed: set[str]) -> dict[str, object] | None:
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"invalid": True}
    if not isinstance(value, dict):
        return {"invalid": True}
    return {key: value[key] for key in sorted(allowed & value.keys())}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=pathlib.Path)
    args = parser.parse_args()
    repositories = sorted(path.parent for path in args.root.glob("*/.git") if path.is_dir())
    inventory = []
    for repo in repositories:
        config = repo / ".infisical.json"
        files = tracked_files(repo)
        inventory.append({
            "repository": repo.name,
            "configured": config.is_file(),
            "runtimeClass": runtime_class(repo, files),
            "secretNames": referenced_secret_names(repo),
            "policy": "explicit-manifest-required" if config.is_file() else "not-enrolled",
            "manifest": safe_metadata(
                repo / ".install-doctor" / "infisical-workload.json",
                {"schemaVersion", "overbroad", "authMode", "delivery"},
            ),
            "evidence": safe_metadata(
                repo / ".install-doctor" / "infisical-evidence.json",
                {"schemaVersion", "state", "verifiedAt"},
            ),
        })
    print(json.dumps({"schemaVersion": 1, "repositories": inventory}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
