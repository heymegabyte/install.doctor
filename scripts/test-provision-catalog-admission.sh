#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P=0 F=0
pass() { printf 'PASS %s\n' "$1"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$1" >&2; F=$((F + 1)); }
sha() { shasum -a 256 "$1" | awk '{print $1}'; }

if grep -q 'idInstallSealedHandoffFile.*VERIFIED_CATALOG.*USER_CATALOG' "$PROVISION" \
  && grep -q 'INSTALL_DOCTOR_CATALOG_PATH INSTALL_DOCTOR_CATALOG_SHA256' "$PROVISION"; then
  pass 'root-to-user handoff seals and allowlists catalog authority'
else fail 'root-to-user catalog handoff is incomplete'; fi

mkdir -p "$TMP/state" "$TMP/source"
printf '[]\n' > "$TMP/source/catalog.json"
chmod 0600 "$TMP/source/catalog.json"

run_remote() {
  local path="$1" digest="$2" state="$3"
  HOME="$TMP" INSTALL_DOCTOR_VERIFIED_MANIFEST=remote INSTALL_DOCTOR_CATALOG_PATH="$path" INSTALL_DOCTOR_CATALOG_SHA256="$digest" \
    bash -c 'source "$1"; idAdmitVerifiedCatalog "$2" || exit $?; printf "%s\n" "$INSTALL_DOCTOR_CATALOG_PATH"' _ "$PROVISION" "$state"
}

ADMITTED="$(run_remote "$TMP/source/catalog.json" "$(sha "$TMP/source/catalog.json")" "$TMP/state")" || ADMITTED=''
if [ -f "$ADMITTED" ] && [ "$(sha "$ADMITTED")" = "$(sha "$TMP/source/catalog.json")" ] \
  && [ "$(stat -f %Lp "$ADMITTED" 2>/dev/null || stat -c %a "$ADMITTED")" = 600 ]; then
  pass 'remote catalog is admitted as a private content-addressed copy'
else fail 'valid remote catalog was not admitted'; fi

expect_reject() {
  local label="$1" path="$2" digest="$3" state="$4"
  if run_remote "$path" "$digest" "$state" >/dev/null 2>&1; then fail "$label"; else pass "$label"; fi
}

expect_reject 'digest mismatch is rejected' "$TMP/source/catalog.json" "$(printf '0%.0s' {1..64})" "$TMP/bad-digest"
expect_reject 'relative catalog path is rejected' 'catalog.json' "$(sha "$TMP/source/catalog.json")" "$TMP/relative"
ln -s "$TMP/source/catalog.json" "$TMP/source/catalog.link"
expect_reject 'catalog symlink is rejected' "$TMP/source/catalog.link" "$(sha "$TMP/source/catalog.json")" "$TMP/symlink"
ln "$TMP/source/catalog.json" "$TMP/source/catalog.hardlink"
expect_reject 'multiply-linked catalog is rejected' "$TMP/source/catalog.json" "$(sha "$TMP/source/catalog.json")" "$TMP/hardlink"
rm "$TMP/source/catalog.hardlink"
chmod 0644 "$TMP/source/catalog.json"
expect_reject 'non-private remote catalog is rejected' "$TMP/source/catalog.json" "$(sha "$TMP/source/catalog.json")" "$TMP/public"
chmod 0600 "$TMP/source/catalog.json"
printf '{}\n' > "$TMP/source/object.json"; chmod 0600 "$TMP/source/object.json"
expect_reject 'non-array JSON catalog is rejected' "$TMP/source/object.json" "$(sha "$TMP/source/object.json")" "$TMP/object"
printf '{broken\n' > "$TMP/source/broken.json"; chmod 0600 "$TMP/source/broken.json"
expect_reject 'malformed JSON catalog is rejected' "$TMP/source/broken.json" "$(sha "$TMP/source/broken.json")" "$TMP/broken"
if HOME="$TMP" INSTALL_DOCTOR_VERIFIED_MANIFEST=remote bash -c 'source "$1"; idAdmitVerifiedCatalog "$2"' _ "$PROVISION" "$TMP/missing" >/dev/null 2>&1; then
  fail 'remote bootstrap without catalog authority is rejected'
else pass 'remote bootstrap without catalog authority is rejected'; fi

LOCAL="$TMP/local"
mkdir -p "$LOCAL/home" "$LOCAL/packages/control-plane/src" "$TMP/local-state"
printf '[]\n' > "$LOCAL/packages/control-plane/src/catalog.json"
git -C "$LOCAL" init --quiet
git -C "$LOCAL" config user.email fixture@example.invalid
git -C "$LOCAL" config user.name Fixture
git -C "$LOCAL" add . && git -C "$LOCAL" commit --quiet -m fixture
COMMIT="$(git -C "$LOCAL" rev-parse HEAD)"
LOCAL_ADMITTED="$(HOME="$TMP" INSTALL_DOCTOR_CHEZMOI_SOURCE="$LOCAL/home" INSTALL_DOCTOR_SOURCE_COMMIT="$COMMIT" \
  bash -c 'source "$1"; idAdmitVerifiedCatalog "$2"; printf "%s\n" "$INSTALL_DOCTOR_CATALOG_PATH"' _ "$PROVISION" "$TMP/local-state")" || LOCAL_ADMITTED=''
if [ -f "$LOCAL_ADMITTED" ]; then pass 'clean local checkout derives catalog authority from the exact commit'; else fail 'local checkout derivation failed'; fi
printf ' \n' >> "$LOCAL/packages/control-plane/src/catalog.json"
if HOME="$TMP" INSTALL_DOCTOR_CHEZMOI_SOURCE="$LOCAL/home" INSTALL_DOCTOR_SOURCE_COMMIT="$COMMIT" \
  bash -c 'source "$1"; idAdmitVerifiedCatalog "$2"' _ "$PROVISION" "$TMP/local-dirty" >/dev/null 2>&1; then
  fail 'dirty local catalog is rejected'
else pass 'dirty local catalog is rejected'; fi

printf 'provision-catalog-admission: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
