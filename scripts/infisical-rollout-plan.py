#!/usr/bin/env python3
"""Create a deterministic, value-free staged Infisical rollout plan."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


STATES = {"unenrolled", "manifest-missing", "overbroad", "verified", "stale", "revoked"}


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("inventory must be an object")
    return value


def state(entry: dict[str, Any]) -> str:
    configured = entry.get("configured") is True
    manifest = entry.get("manifest")
    evidence = entry.get("evidence")
    if not configured:
        return "unenrolled"
    if not isinstance(manifest, dict):
        return "manifest-missing"
    if manifest.get("overbroad") is True:
        return "overbroad"
    if not isinstance(evidence, dict):
        return "stale"
    declared = evidence.get("state")
    if declared not in {"verified", "stale", "revoked"}:
        raise ValueError("evidence.state must be verified, stale, or revoked")
    return declared


def plan(inventory: dict[str, Any], batch_size: int) -> dict[str, Any]:
    repositories = inventory.get("repositories")
    if inventory.get("schemaVersion") != 1 or not isinstance(repositories, list):
        raise ValueError("unsupported inventory")
    if batch_size < 1 or batch_size > 25:
        raise ValueError("batch size must be between 1 and 25")
    records: list[dict[str, Any]] = []
    candidates: dict[str, list[str]] = defaultdict(list)
    for raw in repositories:
        if not isinstance(raw, dict) or not isinstance(raw.get("repository"), str):
            raise ValueError("invalid repository record")
        current = state(raw)
        runtime = raw.get("runtimeClass", "unknown")
        if not isinstance(runtime, str) or not runtime:
            raise ValueError("runtimeClass must be a non-empty string")
        records.append({"repository": raw["repository"], "runtimeClass": runtime, "state": current})
        if current in {"manifest-missing", "stale"}:
            candidates[runtime].append(raw["repository"])
    canaries: list[dict[str, str]] = []
    batches: list[dict[str, Any]] = []
    for runtime in sorted(candidates):
        names = sorted(candidates[runtime])
        if not names:
            continue
        canaries.append({"runtimeClass": runtime, "repository": names[0]})
        remaining = names[1:]
        for offset in range(0, len(remaining), batch_size):
            batches.append({
                "runtimeClass": runtime,
                "repositories": remaining[offset:offset + batch_size],
                "requiresCanary": names[0],
                "onFailure": "stop-class-and-restore-previous-configuration",
            })
    return {
        "schemaVersion": 1,
        "mutationAllowed": False,
        "fixtures": ["manifest-validation", "allow-deny-authorization", "leak-scan", "rotation-reload", "revocation"],
        "repositories": sorted(records, key=lambda item: item["repository"]),
        "canaries": canaries,
        "batches": batches,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("inventory", type=Path)
    parser.add_argument("--batch-size", type=int, default=5)
    args = parser.parse_args()
    print(json.dumps(plan(load(args.inventory), args.batch_size), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
