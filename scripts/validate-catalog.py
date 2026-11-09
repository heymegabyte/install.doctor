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
import pathlib
import re
import subprocess

MODES = {"cli", "app", "service"}
DELIVERY_MODES = {"eager", "lazy"}
LOAD_POLICIES = {
    "lazy",
    "eager-bootstrap",
    "eager-supported-path",
    "eager-security-recovery",
    "eager-service",
}
PRELOAD_REASONS = {
    "bootstrap-critical",
    "lazy-installer-substrate",
    "security-recovery-prerequisite",
    "desired-state-service",
    "shell-profile-core",
    "web-dev-core",
    "media-management-core",
    "lsp-core",
}
VALID_MANAGERS = {
    "brew",
    "apt",
    "dnf",
    "pacman",
    "cask",
    "choco",
    "scoop",
    "go",
    "cargo",
    "npm",
    "pipx",
    "pip",
    "gem",
    "apk",
    "flatpak",
}
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
            if not isinstance(v, list) or (fld == "platforms" and not v):
                problems.append(f"{nm}: {fld!r} must be a list{'' if fld == 'providers' else ' with at least one platform'}")
        if not (e.get("providers") or e.get("artifacts")):
            problems.append(f"{nm}: entry requires a package-manager provider or immutable artifact")
        if e.get("installMode") not in MODES:
            problems.append(f"{nm}: installMode {e.get('installMode')!r} not in {sorted(MODES)}")
        service_declarations = e.get("serviceDeclarations")
        if (e.get("installMode") == "service" and not isinstance(service_declarations, list)) or (e.get("installMode") == "cli" and isinstance(service_declarations, list)):
            problems.append(f"{nm}: service installMode requires serviceDeclarations and CLI entries cannot declare services")
        if isinstance(service_declarations, list):
            if not service_declarations or len(service_declarations) > 32:
                problems.append(f"{nm}: serviceDeclarations must contain 1..32 entries")
            for declaration_index, declaration in enumerate(service_declarations):
                prefix = f"{nm}: serviceDeclarations[{declaration_index}]"
                if not isinstance(declaration, dict) or set(declaration) - {"name", "privilege", "packageProvider", "manager"}:
                    problems.append(f"{prefix} must be a strict declaration object")
                    continue
                if not isinstance(declaration.get("name"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9@._:+/-]{0,127}", declaration["name"]):
                    problems.append(f"{prefix} has an invalid service name")
                if declaration.get("privilege") not in {"user", "admin"}:
                    problems.append(f"{prefix} has an invalid privilege")
                selector = declaration.get("packageProvider")
                if selector is not None and (not isinstance(selector, str) or not re.fullmatch(r"[a-z0-9][a-z0-9._+-]{0,127}", selector)):
                    problems.append(f"{prefix} has an invalid package provider selector")
                manager = declaration.get("manager")
                if manager is not None and manager != "systemd":
                    problems.append(f"{prefix} has an unsupported service manager")
                if manager == "systemd" and (not isinstance(declaration.get("name"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.service", declaration["name"])):
                    problems.append(f"{prefix} has an invalid systemd service unit")
        if e.get("deliveryMode") not in DELIVERY_MODES:
            problems.append(f"{nm}: deliveryMode {e.get('deliveryMode')!r} not in {sorted(DELIVERY_MODES)}")
        if e.get("loadPolicy") not in LOAD_POLICIES:
            problems.append(f"{nm}: loadPolicy {e.get('loadPolicy')!r} not in {sorted(LOAD_POLICIES)}")
        if not isinstance(e.get("loadRationale"), str) or not e.get("loadRationale"):
            problems.append(f"{nm}: loadRationale must be a non-empty string")
        if not isinstance(e.get("preload"), bool):
            problems.append(f"{nm}: preload must be a boolean")
        if e.get("preload") is True and e.get("preloadReason") not in PRELOAD_REASONS:
            problems.append(f"{nm}: eager preload has invalid reason {e.get('preloadReason')!r}")
        if e.get("preload") is not True and "preloadReason" in e:
            problems.append(f"{nm}: preloadReason is only valid for an eager preload")
        if "systemIdentityReconciliation" in e and not isinstance(e.get("systemIdentityReconciliation"), bool):
            problems.append(f"{nm}: systemIdentityReconciliation must be a boolean when present")
        expected_delivery = "eager" if e.get("loadPolicy") != "lazy" else "lazy"
        if e.get("deliveryMode") != expected_delivery:
            problems.append(
                f"{nm}: deliveryMode {e.get('deliveryMode')!r} does not match installMode/preload; "
                f"expected {expected_delivery!r}"
            )
        if e.get("loadPolicy") == "lazy" and e.get("loadRationale") != "default-lazy":
            problems.append(f"{nm}: lazy entries must use the deterministic default-lazy rationale")
        if e.get("loadPolicy") != "lazy" and ":" not in str(e.get("loadRationale", "")):
            problems.append(f"{nm}: eager loadRationale must name its owning reference")
        provs = set(e.get("providers") or [])
        unknown_provs = provs - VALID_MANAGERS
        if unknown_provs:
            problems.append(f"{nm}: unknown package manager provider(s) {sorted(unknown_provs)}")
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
    artifact_validator = pathlib.Path(__file__).with_name("validate-catalog-artifacts.mjs")
    artifact_result = subprocess.run(
        ["node", str(artifact_validator), path], capture_output=True, text=True, check=False
    )
    if artifact_result.returncode != 0:
        diagnostic = artifact_result.stderr.strip().splitlines()[-1] if artifact_result.stderr.strip() else "unknown error"
        print(f"FATAL: {diagnostic}")
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
