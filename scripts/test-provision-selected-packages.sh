#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
P=0 F=0
cleanup() { rm -rf -- "$TMP_DIR"; }
trap cleanup EXIT
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

# shellcheck source=/dev/null
source "$ROOT/scripts/provision.sh"
mkdir -p "$TMP_DIR/source/home" "$TMP_DIR/bin"
LEDGER="$TMP_DIR/ledger"
cat > "$TMP_DIR/bin/installx" <<'INSTALLX'
#!/usr/bin/env bash
printf '%s\0' "$@" >> "$INSTALLX_LEDGER"
printf '\n' >> "$INSTALLX_LEDGER"
INSTALLX
chmod 0700 "$TMP_DIR/bin/installx"
export INSTALL_DOCTOR_BOOTSTRAP_INSTALLX="$TMP_DIR/bin/installx"
export INSTALL_DOCTOR_BOOTSTRAP_INSTALLX_SHA256
INSTALL_DOCTOR_BOOTSTRAP_INSTALLX_SHA256="$(shasum -a 256 "$INSTALL_DOCTOR_BOOTSTRAP_INSTALLX" | awk '{print $1}')"
export INSTALL_DOCTOR_CHEZMOI_SOURCE="$TMP_DIR/source/home"
export INSTALLX_LEDGER="$LEDGER"

export INSTALL_DOCTOR_SELECTED_PACKAGES=''
if idRunSelectedDesiredPackages apply && [ ! -e "$LEDGER" ]; then
  pass 'empty selected package set is a mutation-free no-op'
else
  fail 'empty selected package set invoked installx'
fi

export INSTALL_DOCTOR_SELECTED_PACKAGES='alpha,beta-tool'
if idRunSelectedDesiredPackages apply; then
  if node -e "const b=require('node:fs').readFileSync(process.argv[1]);if(!b.equals(Buffer.from('--lazy\\0alpha\\0beta-tool\\0\\n')))process.exit(1)" "$LEDGER"; then
    pass 'apply passes only exact selected roots'
  else fail 'apply argv broadened or reordered selection'; fi
else
  fail 'valid selected package apply was rejected'
fi

: > "$LEDGER"
if idRunSelectedDesiredPackages check; then
  if node -e "const b=require('node:fs').readFileSync(process.argv[1]);if(!b.equals(Buffer.from('--check\\0--lazy\\0alpha\\0beta-tool\\0\\n')))process.exit(1)" "$LEDGER"; then
    pass 'check preserves exact selection without catalog expansion'
  else fail 'check argv broadened selection'; fi
else
  fail 'valid selected package check was rejected'
fi

printf '# substituted after approval\n' >> "$INSTALL_DOCTOR_BOOTSTRAP_INSTALLX"
if idRunSelectedDesiredPackages apply >/dev/null 2>&1; then
  fail 'selected package apply accepted a substituted installx executable'
else
  pass 'selected package apply rejects installx substitution after approval'
fi

for invalid in 'alpha,,beta' 'alpha bad' '../alpha' 'alpha;beta'; do
  export INSTALL_DOCTOR_SELECTED_PACKAGES="$invalid"
  if idRunSelectedDesiredPackages apply >/dev/null 2>&1; then
    fail "invalid selection was accepted: $invalid"
  else
    pass "invalid selection fails closed: $invalid"
  fi
done

if ! sed -n '/desired-packages-check)/,/desired-packages-verify)/p' "$ROOT/scripts/provision.sh" | grep -q -- '--all'; then
  pass 'engine-owned selected package operations contain no --all expansion'
else
  fail 'engine-owned selected package operation retains --all expansion'
fi
if ! grep -Fq 'installx --all' "$ROOT/home/.chezmoiscripts/universal/run_after_10-install.sh.tmpl"; then
  pass 'Chezmoi compatibility path cannot expand selection to catalog defaults'
else
  fail 'Chezmoi compatibility path retains --all expansion'
fi

printf 'provision-selected-packages: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
