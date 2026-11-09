#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

test -f "$ROOT/scripts/provision.sh"
test ! -e "$ROOT/scripts/src/provision.sh.tmpl"
grep -q '`scripts/provision.sh` is the authored provisioner source of truth' "$ROOT/scripts/.gomplate.yaml"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FIXTURE="$TMP/origin"
mkdir -p "$FIXTURE/home" "$TMP/data/chezmoi"
printf 'home\n' > "$FIXTURE/.chezmoiroot"
printf 'fixture\n' > "$FIXTURE/home/fixture.txt"
git -C "$FIXTURE" init --quiet
git -C "$FIXTURE" config user.email fixture@install.doctor
git -C "$FIXTURE" config user.name fixture
git -C "$FIXTURE" add .
git -C "$FIXTURE" commit --quiet -m fixture
COMMIT="$(git -C "$FIXTURE" rev-parse HEAD)"
printf 'preserve\n' > "$TMP/data/chezmoi/user-work"
awk '/^idSha256File\(\) \{/{copy=1} copy{print} /^idTrustedGitExecutable\(\) \{/{git=1} copy && git && /^\}/{exit}' "$ROOT/scripts/provision.sh" > "$TMP/clone-function.sh"
awk '/^cloneChezmoiSourceRepo\(\) \{/{copy=1} copy{print} /^verifyChezmoiSourceRepo\(\) \{/{verify=1} copy && verify && /^\}/{exit}' "$ROOT/scripts/provision.sh" >> "$TMP/clone-function.sh"
GIT_PATH="$(command -v git)"
GIT_SHA256="$(shasum -a 256 "$GIT_PATH" | awk '{print $1}')"

XDG_DATA_HOME="$TMP/data" HOME="$TMP/home" START_REPO="$FIXTURE" \
  INSTALL_DOCTOR_RELEASE_ID=fixture-release INSTALL_DOCTOR_SOURCE_COMMIT="$COMMIT" \
  INSTALL_DOCTOR_GIT_PATH="$GIT_PATH" INSTALL_DOCTOR_GIT_SHA256="$GIT_SHA256" \
  bash -c 'set -u; logg() { :; }; detect_os() { printf linux; }; source "$1"; cloneChezmoiSourceRepo; test "$INSTALL_DOCTOR_CHEZMOI_SOURCE" = "$XDG_DATA_HOME/install.doctor/releases/fixture-release/source/home"' _ "$TMP/clone-function.sh"
test "$(git -C "$TMP/data/install.doctor/releases/fixture-release/source" rev-parse HEAD)" = "$COMMIT"
test "$(cat "$TMP/data/chezmoi/user-work")" = preserve

printf 'tamper\n' >> "$TMP/data/install.doctor/releases/fixture-release/source/home/fixture.txt"
if XDG_DATA_HOME="$TMP/data" HOME="$TMP/home" START_REPO="$FIXTURE" \
  INSTALL_DOCTOR_RELEASE_ID=fixture-release INSTALL_DOCTOR_SOURCE_COMMIT="$COMMIT" \
  INSTALL_DOCTOR_GIT_PATH="$GIT_PATH" INSTALL_DOCTOR_GIT_SHA256="$GIT_SHA256" \
  bash -c 'set -u; logg() { :; }; detect_os() { printf linux; }; source "$1"; cloneChezmoiSourceRepo' _ "$TMP/clone-function.sh"; then
  printf 'Tampered immutable source was accepted\n' >&2
  exit 1
fi

printf 'Bootstrap source-authority tests passed.\n'
