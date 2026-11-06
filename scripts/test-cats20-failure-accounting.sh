#!/usr/bin/env bash
# Hermetic regression coverage for catalog audit CATS-20 false-success branches.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"
SERVICES="$ROOT/home/dot_config/system/usr/local/bin/executable_process-software-services"
POST="$ROOT/home/dot_config/system/usr/local/bin/executable_process-software-post-scripts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P=0
F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if ! grep -Fq 'async function runScript' "$INSTALLX" \
  && grep -Fq 'catalog script providers are unsupported' "$INSTALLX"; then
  pass "installx rejects catalog script providers instead of executing or masking them"
else
  fail "installx retains an executable or non-failing catalog script provider"
fi
if grep -q 'failures.length' "$INSTALLX" && grep -q 'installation task(s) failed' "$INSTALLX"; then
  pass "installx aggregates rejected install tasks before reporting completion"
else
  fail "installx lacks rejected-task failure accounting"
fi

mkdir -p "$TMP/bin" "$TMP/home/.local/share/chezmoi"
printf 'softwarePackages: {}\n' > "$TMP/home/.local/share/chezmoi/software.yml"

cat > "$TMP/bin/gum" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >&2
SH
cat > "$TMP/bin/yq" <<'SH'
#!/usr/bin/env bash
args="$*"
case "$args" in
  *'keys[]'*) printf '%s\n' fixture ;;
  *'._bin // ""'*) printf '%s\n' fixture-bin ;;
  *'._service // []'*) printf '%s\n' '["fixture.service"]' ;;
  *'._serviceEnabled'*) printf '%s\n' true ;;
  *'type'*) printf '%s\n' '!!str' ;;
  *'.[] | @json'*) printf '%s\n' '"fixture.service"' ;;
  *) exit 2 ;;
esac
SH
cat > "$TMP/bin/systemctl" <<'SH'
#!/usr/bin/env bash
exit "${SYSTEMCTL_TEST_STATUS:-0}"
SH
cat > "$TMP/bin/fixture-bin" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$TMP/bin/"*

if HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" INSTALL_DOCTOR_SELECTED_SERVICES=fixture SYSTEMCTL_TEST_STATUS=23 bash "$SERVICES" >"$TMP/service.out" 2>"$TMP/service.err"; then
  fail "service processor returned success after systemctl failed"
else
  pass "service processor propagates a background service failure"
fi
if grep -q 'Service management failed for fixture' "$TMP/service.err"; then
  pass "service failure ledger identifies the owning package"
else
  fail "service failure ledger omitted the owning package"
fi
if HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" INSTALL_DOCTOR_SELECTED_SERVICES=fixture SYSTEMCTL_TEST_STATUS=0 bash "$SERVICES" >/dev/null 2>&1; then
  pass "service processor still succeeds when the service action succeeds"
else
  fail "valid service action became fatal"
fi
mv "$TMP/bin/fixture-bin" "$TMP/bin/fixture-bin.absent"
if HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" INSTALL_DOCTOR_SELECTED_SERVICES=fixture SYSTEMCTL_TEST_STATUS=23 bash "$SERVICES" >/dev/null 2>&1; then
  pass "missing optional tool remains a non-fatal skip"
else
  fail "missing optional tool became fatal by default"
fi

if ! grep -q 'bash -c' "$POST" && grep -q 'Catalog _post commands are unsupported' "$POST"; then
  pass "catalog post metadata is validated without granting shell authority"
else
  fail "catalog post metadata retains an executable shell path"
fi

if grep -q '^WantedBy=multi-user.target$' "$ROOT/home/dot_config/system/etc/systemd/system/s3-private.service.tmpl" \
  && grep -q '^WantedBy=multi-user.target$' "$ROOT/home/dot_config/system/etc/systemd/system/s3-public.service.tmpl"; then
  pass "S3 system units enable against multi-user.target"
else
  fail "S3 system units still use a non-system boot target"
fi

printf 'cats20-failure-accounting: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
