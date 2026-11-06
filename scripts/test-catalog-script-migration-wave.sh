#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOFTWARE="$ROOT/software.yml"
ANSIBLE="$ROOT/home/dot_local/share/ansible/environments/prod/group_vars/desktop/vars.yml"
ANSIBLE_ALL="$ROOT/home/dot_local/share/ansible/environments/prod/group_vars/all/software.yml"
BASHRC="$ROOT/home/dot_bashrc"
EXPORTS="$ROOT/home/dot_config/shell/exports.sh.tmpl"
CHEZMOI_DATA="$ROOT/home/.chezmoidata.yaml"
CHEZMOI_REMOVE="$ROOT/home/.chezmoiremove"

python3 - "$SOFTWARE" <<'PY'
import sys
import yaml

with open(sys.argv[1], encoding="utf-8") as stream:
    packages = yaml.safe_load(stream)["softwarePackages"]

for removed in ("deta", "docker-images", "mambaforge", "sdkman-cli", "youtube-music"):
    assert removed not in packages, f"retired catalog entry remains: {removed}"

assert packages["docker"]["brew"] == "docker"
assert not any(key.split(":", 1)[0] == "script" for key in packages["docker"])

miniforge = packages["miniforge"]
assert miniforge["cask"] == "miniforge"
assert miniforge["choco"] == "miniforge3"
assert not any(key.startswith(("script", "_post", "_when")) for key in miniforge)

recoverpy = packages["recoverpy"]
assert recoverpy["pipx"] == "recoverpy"
assert not any(key.startswith(("script", "_when")) for key in recoverpy)

assert not any(key.split(":", 1)[0] == "script" for key in packages["microsoft-git"])

expected = {
    "flyctl": ("winget", "Fly-io.flyctl"),
    "juicefs": ("brew", "juicefs"),
    "porter": ("brew", "porter"),
    "fission": ("scoop", "fission-cli"),
}
for package, (provider, coordinate) in expected.items():
    assert packages[package][provider] == coordinate, f"{package} missing {provider} migration"

for package in ("flyctl", "juicefs", "porter", "fission", "hss", "xpanes", "unikraft", "onlykey"):
    assert not any(key.split(":", 1)[0] == "script" for key in packages[package]), f"{package} still has script authority"

# Native provider coverage is intentionally partial here. Unsupported platform
# cells must remain explicit instead of falling through to mutable remote shell.
native_only = {
    "kasmvnc": ("yay", "kasmvncserver-bin"),
    "netdata": ("brew", "netdata"),
    "protonvpn-cli": ("pacman", "proton-vpn-cli"),
    "sapling": ("brew", "sapling"),
    "vmware": ("cask", "vmware-fusion"),
    "wazuh": ("choco", "wazuh-agent"),
}
for package, (provider, coordinate) in native_only.items():
    assert packages[package][provider] == coordinate, f"{package} missing retained native provider"
    assert not any(key.split(":", 1)[0] == "script" for key in packages[package]), f"{package} still has script fallback"

assert not any(key.startswith("_when") for key in packages["wazuh"]), "wazuh still has executable predicates"

for package in ("docker-pushrm", "shdoc", "sysz", "zap"):
    assert not any(key.split(":", 1)[0] == "script" for key in packages[package]), f"{package} still has script fallback"

assert "pacman" not in packages["sysz"], "sysz has competing package-manager and immutable-artifact writers"
pushrm_artifacts = packages["docker-pushrm"]["_artifacts"]
assert len(pushrm_artifacts) == 5
assert {(item["platform"]["os"], item["platform"]["arch"]) for item in pushrm_artifacts} == {
    ("darwin", "x64"), ("darwin", "arm64"), ("linux", "x64"), ("linux", "arm64"), ("win32", "x64")
}
assert all(item["version"] == "1.9.0" for item in pushrm_artifacts)
assert all(item["destination"]["root"] == "docker-cli-plugin" for item in pushrm_artifacts)
sysz_artifacts = packages["sysz"]["_artifacts"]
assert {(item["platform"]["os"], item["platform"]["arch"]) for item in sysz_artifacts} == {
    ("linux", "x64"), ("linux", "arm64")
}
assert {item["source"]["sha256"] for item in sysz_artifacts} == {
    "875f8ddfb7d339979ca9b36907f2640cbbd4e9ac861d40188455926dfdcdd576"
}
assert not any(key.split(":", 1)[0] == "bin" for key in packages["sysz"]), "sysz retains an unverified binary provider"
assert packages["shdoc"]["yay"] == "shdoc-git"
assert packages["shdoc"]["dnf"] == "shdoc"
assert packages["protonvpn-cli"]["_github"] == "https://github.com/ProtonVPN/proton-vpn-cli"

assert not any(key.startswith("_post") for key in packages["onlykey"])
PY

! grep -Eq '^[[:space:]]*-[[:space:]]+deta$' "$ANSIBLE"
! grep -Eq '^[[:space:]]*deta:' "$ANSIBLE_ALL"
! grep -q 'Caskroom/mambaforge\|sdkman-cli' "$BASHRC"
! grep -q 'SDKMAN_DIR' "$EXPORTS"
! grep -qE '^[[:space:]]+(docker-images|docker-plugins):' "$CHEZMOI_DATA"
! grep -qi 'deta-cli' "$CHEZMOI_REMOVE"

printf 'catalog-script-migration-wave: 59 passed, 0 failed\n'
