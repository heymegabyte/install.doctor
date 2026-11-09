#!/usr/bin/env bash
# Guard the curl-to-engine closure against quietly regaining optional packages.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

basic="$(sed -n '/^ensureBasicDeps()/,/^}/p' "$PROVISION")"
brew="$(sed -n '/^ensureHomebrewDeps()/,/^}/p' "$PROVISION")"
prompt="$(sed -n '/^initChezmoiAndPrompt()/,/^}/p' "$PROVISION")"

for package in build-essential base-devel expect moreutils procps procps-ng ruby file gcc; do
  if printf '%s\n' "$basic" | grep -Fq "$package"; then
    fail "optional native package is still in bootstrap closure: $package"
  else
    pass "optional native package remains lazy: $package"
  fi
done

if printf '%s\n' "$basic" | grep -Fq 'rsync'; then
  pass 'rsync remains eager while the system-files task requires it'
else
  fail 'rsync is missing from the current system-files dependency closure'
fi

if printf '%s\n' "$basic" | grep -Fq 'idTrustedGitExecutable' \
  && printf '%s\n' "$basic" | grep -Fq 'Minimal bootstrap dependencies did not satisfy their approved postcondition'; then
  pass 'native bootstrap dependency apply has an exact fail-closed postcondition'
else
  fail 'native bootstrap dependency apply can return without proving its exact postcondition'
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/empty" "$TMP_DIR/tools"
for tool in curl rsync; do
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$TMP_DIR/tools/$tool"
  chmod 0700 "$TMP_DIR/tools/$tool"
done
if PATH="$TMP_DIR/empty" /bin/bash -c '
  eval "$1"
  logg() { :; }
  detect_os() { printf "%s\n" linux; }
  idTrustedGitExecutable() { return 1; }
  ensureBasicDeps
' _ "$basic"; then
  fail 'native bootstrap dependency apply accepted a host with no usable package manager or tools'
else
  pass 'native bootstrap dependency apply rejects an unresolved unsupported host'
fi
if PATH="$TMP_DIR/tools" /bin/bash -c '
  eval "$1"
  logg() { :; }
  detect_os() { printf "%s\n" linux; }
  idTrustedGitExecutable() { return 0; }
  ensureBasicDeps
' _ "$basic"; then
  pass 'native bootstrap dependency apply accepts the exact satisfied closure without mutation'
else
  fail 'native bootstrap dependency apply rejected the exact satisfied closure'
fi

for package in glow gsed coreutils moreutils expect gcc; do
  if printf '%s\n' "$brew" | grep -Fq "installBrewPackage \"$package\"" || printf '%s\n' "$brew" | grep -Fq "brew install --quiet $package"; then
    fail "optional Homebrew package is still in bootstrap closure: $package"
  else
    pass "optional Homebrew package remains lazy: $package"
  fi
done

homebrew="$(sed -n '/^ensureHomebrew()/,/^}/p' "$PROVISION")"
if grep -q '^ensureGcc() {' "$PROVISION" \
  || printf '%s\n%s\n' "$homebrew" "$brew" | grep -Eq 'ensureGcc|installBrewPackage "?gcc"?|brew install( --quiet)? gcc'; then
  fail 'GCC remains in the eager Homebrew bootstrap closure'
else
  pass 'GCC is absent from native and Homebrew eager bootstrap tasks'
fi

engine_plan="$(sed -n '/const homebrewToolsTask = {/,/const chezmoiInitTask = {/p' "$PROVISION")"
if printf '%s\n' "$engine_plan" | grep -Eq "tools: \['chezmoi', 'gum', 'zx'\]" \
  && ! printf '%s\n' "$engine_plan" | grep -Eq "['\"]gcc['\"]"; then
  pass 'canonical engine Homebrew-tools plan excludes GCC'
else
  fail 'canonical engine Homebrew-tools plan is not the minimal chezmoi/gum/zx closure'
fi

if grep -Fq "Node.js is required to create a validated install plan" "$PROVISION"; then
  pass 'missing Node.js fails explicitly before the install plan'
else
  fail 'Node.js runtime prerequisite is not explicit'
fi

for package in gum zx; do
  if printf '%s\n' "$brew" | grep -Fq "installBrewPackage \"$package\""; then
    pass "$package remains eager while the current apply spine requires it"
  else
    fail "$package is missing from the current apply-spine dependency closure"
  fi
done

if printf '%s\n' "$brew" | grep -Fq 'installBrewPackage "chezmoi"'; then
  pass 'Chezmoi remains in the direct apply closure'
else
  fail 'Chezmoi is missing from the direct apply closure'
fi

if printf '%s\n' "$prompt" | grep -Eq 'brew install.*gum'; then
  fail 'interactive prompt path still installs Gum eagerly'
else
  pass 'interactive prompt degrades without eagerly installing Gum'
fi

printf 'bootstrap-lazy-closure: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
