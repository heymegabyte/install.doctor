#!/usr/bin/env bash
# scripts/test-xdg-config-migration.sh — Dead XDG config-source guard (removal wave two, XS-11/12/13).
#
# CARGO_HOME, GRADLE_USER_HOME, and MAVEN_CONFIG were migrated to XDG locations long ago:
#   - cargo  -> ${XDG_DATA_HOME}/cargo   (home/dot_local/share/cargo/config.toml.tmpl)
#   - gradle -> ${XDG_DATA_HOME}/gradle  (home/dot_local/share/gradle/init.gradle.tmpl)
#   - maven  -> ${XDG_CONFIG_HOME}/maven (home/dot_config/maven/settings.xml.tmpl)
# and home/.chezmoiremove already deletes the LEGACY targets (~/.cargo, ~/.gradle, ~/.m2) on existing
# machines. The legacy SOURCE dirs (home/dot_cargo, home/dot_gradle, home/dot_m2) kept shipping byte-
# identical config to the dead ~/.X location, producing deploy-then-self-delete churn every `chezmoi apply`.
#
# This guard asserts: (1) the dead sources are gone, (2) the live XDG sources remain, (3) the env vars
# still point at the XDG locations, and (4) .chezmoiremove still cleans the legacy targets — so a future
# edit can't silently re-introduce the dead path. These are ACTIVE tools (unlike the removed-tool guard),
# only their config LOCATION migrated. Pure file assertions, no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "dead XDG config-source guard (cargo/gradle/maven home migration)"

# 1. The three legacy SOURCE dirs that deployed config to a ~/.X path the env vars no longer read.
dead=""
for t in dot_cargo dot_gradle dot_m2; do
  [ -d "home/$t" ] && dead="$dead home/$t"
done
if [ -z "$dead" ]; then
  pass "no dead legacy config sources ship (home/dot_cargo, home/dot_gradle, home/dot_m2 removed)"
else
  fail "legacy config source dirs still ship:$dead — they deploy to a ~/.X path the env vars no longer read"
fi

# 2. The LIVE XDG sources must remain — deleting a dead source must never delete the canonical config.
live_missing=""
for f in \
  "home/dot_local/share/cargo/config.toml.tmpl" \
  "home/dot_local/share/gradle/init.gradle.tmpl" \
  "home/dot_config/maven/settings.xml.tmpl"; do
  [ -f "$f" ] || live_missing="$live_missing $f"
done
if [ -z "$live_missing" ]; then
  pass "live XDG config sources present (cargo/gradle/maven)"
else
  fail "live XDG config source missing:$live_missing — the canonical config was deleted alongside the dead source"
fi

# 3. The env vars still point at the XDG locations (else a legacy ~/.X config becomes live again).
exports="home/dot_config/shell/exports.sh.tmpl"
env_ok=1
grep -q 'CARGO_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/cargo"' "$exports" || env_ok=0
grep -q 'GRADLE_USER_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/gradle"' "$exports" || env_ok=0
grep -q 'MAVEN_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/maven/settings.xml"' "$exports" || env_ok=0
if [ "$env_ok" -eq 1 ]; then
  pass "CARGO_HOME/GRADLE_USER_HOME/MAVEN_CONFIG point at their XDG locations"
else
  fail "an XDG env var no longer points at its XDG location — a legacy ~/.X config would become live again"
fi

# 4. .chezmoiremove still cleans the legacy targets on EXISTING machines (source removal won't propagate otherwise).
rmfile="home/.chezmoiremove"
rm_missing=""
for p in '.cargo' '.gradle' '.m2'; do
  grep -qxF "$p" "$rmfile" 2>/dev/null || rm_missing="$rm_missing $p"
done
if [ -z "$rm_missing" ]; then
  pass ".chezmoiremove cleans the legacy ~/.cargo ~/.gradle ~/.m2 targets on existing machines"
else
  fail ".chezmoiremove MISSING legacy cleanup path(s):$rm_missing — existing machines keep the dead config"
fi

say "xdg-config-migration: $P passed, $F failed"
[ "$F" -eq 0 ]
