#!/usr/bin/env bash
# scripts/test-dead-fleet-config.sh — Dead fleet-config guard (removal wave two, XS-08/XS-09).
#
# Two root-level fleet manifests shipped byte-for-byte to every clone but were never read by any
# bootstrap, provisioner, chezmoi, CI, or test path:
#   - file-system.yml — a gitfs mount manifest for the RETIRED `ProfessorManhattan` org that maps
#     `$HOME/.config` and `$HOME/Library/Preferences` to a legacy git remote outside the canonical
#     heymegabyte provenance. A dead mount manifest is fleet-config drift + a supply-chain hazard.
#   - sake.yaml — a stale `sake` host inventory that embeds LIVE fleet hostnames
#     (maas.ssh.megabyte.space, workhorse.ssh.megabyte.space) and a legacy GitLab START_REPO in a
#     PUBLIC repo. This contradicts the server-ingress-ownership rule (CLAUDE.md §4): the provisioner
#     MUST NOT invent production hostnames or point at a retired GitLab origin; host identity lives in
#     per-host recovery repos, not the public provisioner.
#
# Both had ZERO reachable callers (git grep confirms). This guard asserts: (1) the two dead manifests
# are gone, (2) the `sake` TOOL is preserved (software.yml entry + bash completion — the package is
# distinct from the dead host-inventory file, so an over-eager deletion must not take the tool down
# with it), and (3) the canonical /start entrypoints still reference neither file. The detector is
# re-run against planted fixtures to prove it is non-vacuous. Pure file assertions, no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

# The detector under test: echo the names of any dead root-level fleet manifest present under $1.
find_dead() {
  local out=""
  for f in file-system.yml sake.yaml; do
    [ -e "$1/$f" ] && out="$out $f"
  done
  printf '%s' "$out"
}

say "dead fleet-config guard (file-system.yml gitfs manifest + sake.yaml host inventory)"

# 1. The two dead root-level manifests must not ship.
dead="$(find_dead "$ROOT")"
if [ -z "$dead" ]; then
  pass "no dead fleet-config manifests ship (file-system.yml, sake.yaml removed)"
else
  fail "dead fleet-config manifest(s) still ship:$dead — gitfs mount manifest / stale host inventory with zero callers"
fi

# 2. The `sake` TOOL survives — deleting the dead host-inventory file must never delete the package.
sake_entry_ok=1
grep -q '^  sake:$' software.yml || sake_entry_ok=0
grep -q 'github.com/alajmo/sake' software.yml || sake_entry_ok=0
[ -f "home/dot_local/share/bash-completion/completions/sake.bash.tmpl" ] || sake_entry_ok=0
if [ "$sake_entry_ok" -eq 1 ]; then
  pass "the sake TOOL is preserved (software.yml entry + bash completion intact — only the dead host inventory was removed)"
else
  fail "the sake tool was removed alongside its dead host-inventory file — software.yml entry / completion is missing"
fi

# 3. The canonical /start entrypoints must not resurrect a reference to either dead manifest.
ref=""
for f in start.sh scripts/provision.sh home/.chezmoiexternal.toml.tmpl home/.chezmoi.yaml.tmpl; do
  [ -f "$f" ] || continue
  grep -lE 'file-system\.yml|sake\.yaml' "$f" >/dev/null 2>&1 && ref="$ref $f"
done
if [ -z "$ref" ]; then
  pass "no /start or chezmoi entrypoint references the dead manifests"
else
  fail "a bootstrap entrypoint re-references a dead manifest:$ref"
fi

# 4. Non-vacuous self-test: plant both manifests in a temp dir and re-run the SAME detector. It must
#    flag both names, proving the clean-tree pass above was a real check and not a vacuous `[ -e ]`.
tmp="$(mktemp -d)"
printf 'mounts:\n  - type: gitfs\n    source: git@github.com:ProfessorManhattan/x.git\n' > "$tmp/file-system.yml"
printf 'servers:\n  maas:\n    host: maas.ssh.megabyte.space\n' > "$tmp/sake.yaml"
planted="$(find_dead "$tmp")"
rm -rf "$tmp"
for name in file-system.yml sake.yaml; do
  case " $planted " in
    *" $name "*) pass "detector flags a planted $name (non-vacuous)" ;;
    *) fail "detector missed a planted $name — the absence check is vacuous" ;;
  esac
done

say "dead-fleet-config: $P passed, $F failed"
[ "$F" -eq 0 ]
