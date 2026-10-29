#!/usr/bin/env python3
# D12/D05/D06 catalog-integrity validator (fire #133). Reads a catalog.json (a list of entries), reports
# integrity conflicts, exits 1 on any. Pure-python so it runs on any host with no node/Volta version coupling
# (the repo root pins node 18 via Volta, which can't strip .ts — see scripts/test-admin-allowlist.sh).
#
# Checks:
#   1. Required fields: name, bin, installMode (non-empty strings); providers + platforms (non-empty lists).
#   2. installMode is one of {cli, app, service} (D06 eager-app / lazy-CLI / service modes).
#   3. providers[] set == pkgs keys set — no provider declared without a package id, no dangling pkg (D03).
#   4. The TRUE binary conflict (D12): two entries sharing a `bin` on an OVERLAPPING platform → an ambiguous
#      lazy-install resolve (which entry's providers win?). A DISJOINT-platform split (e.g. devtoys on macos
#      + devtoys-windows on windows) is legitimate packaging and is NOT flagged.
#
# NOTE: a duplicate `name` is NOT a conflict here — one package legitimately provides several bins (xz →
# lzma/xz/unlzma/unxz), one entry per bin, all sharing the package name. The name-keyed API resolves such a
# group to its canonical (bin===name) entry; see /api/catalog/:name.
#
# Usage: validate-catalog.py [catalog.json]   (defaults to packages/control-plane/src/catalog.json)
import json
import sys
import collections

MODES = {"cli", "app", "service"}


def validate(cat):
    problems = []
    if not isinstance(cat, list):
        return ["catalog is not a JSON array"]
    for i, e in enumerate(cat):
        if not isinstance(e, dict):
            problems.append(f"[{i}]: entry is not an object")
            continue
        nm = e.get("name") if isinstance(e.get("name"), str) and e.get("name") else f"<index {i}>"
        for fld in ("name", "bin", "installMode"):
            v = e.get(fld)
            if not isinstance(v, str) or not v:
                problems.append(f"{nm}: missing/invalid string field {fld!r}")
        for fld in ("providers", "platforms"):
            v = e.get(fld)
            if not isinstance(v, list) or not v:
                problems.append(f"{nm}: {fld!r} must be a non-empty list")
        if e.get("installMode") not in MODES:
            problems.append(f"{nm}: installMode {e.get('installMode')!r} not in {sorted(MODES)}")
        provs = set(e.get("providers") or [])
        pks = set((e.get("pkgs") or {}).keys())
        if provs != pks:
            problems.append(
                f"{nm}: providers {sorted(provs)} != pkgs keys {sorted(pks)} (orphan provider or dangling pkg)"
            )
    by_bin = collections.defaultdict(list)
    for e in cat:
        if isinstance(e, dict) and isinstance(e.get("bin"), str) and e.get("bin"):
            by_bin[e["bin"]].append(e)
    for b, lst in by_bin.items():
        for a in range(len(lst)):
            for c in range(a + 1, len(lst)):
                ov = set(lst[a].get("platforms") or []) & set(lst[c].get("platforms") or [])
                if ov:
                    problems.append(
                        f"bin {b!r}: ambiguous resolve — {lst[a].get('name')!r} and {lst[c].get('name')!r} "
                        f"both claim it on platform(s) {sorted(ov)}"
                    )
    return problems


def main(argv):
    path = argv[1] if len(argv) > 1 else "packages/control-plane/src/catalog.json"
    try:
        cat = json.load(open(path))
    except Exception as exc:  # noqa: BLE001 - surface any read/parse failure as a hard fail
        print(f"FATAL: cannot read {path}: {exc}")
        return 1
    problems = validate(cat)
    if problems:
        print(f"CATALOG CONFLICTS ({len(problems)}):")
        for p in problems:
            print("  ✗", p)
        return 1
    n = len(cat) if isinstance(cat, list) else 0
    print(f"OK: {n} catalog entries, 0 conflicts (bins unambiguous per platform, providers==pkgs, modes valid)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
