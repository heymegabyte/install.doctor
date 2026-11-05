#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-kasmvnc.sh"
RUNNER="$ROOT/home/dot_local/bin/executable_kasmvnc-gnome-loopback-run"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

bash -n "$HOOK" "$RUNNER" && pass 'scripts parse' || fail 'script syntax'
grep -q 'MemTotal' "$HOOK" && grep -q '16777216' "$HOOK" && pass '16 GiB Linux RAM gate' || fail 'missing 16 GiB gate'
grep -q 'INSTALL_DOCTOR_KASMVNC' "$HOOK" && pass 'operator opt-out/override' || fail 'missing opt-out'
grep -q 'IgnoreLid=true' "$HOOK" && grep -q "lid-close-ac-action.*nothing" "$HOOK" && grep -q 'lock-enabled false' "$HOOK" && pass 'closed-lid GNOME session preservation' || fail 'closed-lid policy incomplete'
grep -qE 'gnome-session|wayland-sessions.*gnome' "$HOOK" && pass 'configured GNOME gate' || fail 'missing GNOME gate'
grep -q 'desktop-vnc.service' "$HOOK" && grep -q 'desktop-kasmvnc.service' "$HOOK" && pass 'neutral service units' || fail 'missing neutral units'
kasm_unit="$(sed -n '/cat >"$units\/desktop-kasmvnc.service"/,/^EOF$/p' "$HOOK")"
grep -q 'WantedBy=default.target' <<<"$kasm_unit" && ! grep -q 'PartOf=gnome-session.target' <<<"$kasm_unit" && pass 'KasmVNC gateway survives GNOME session lifecycle' || fail 'gateway remains coupled to GNOME session'
grep -q 'INSTALL_DOCTOR_DESKTOP_BROWSER:-0' "$HOOK" && grep -q 'desktop-browser.service' "$HOOK" && grep -q -- '--remote-debugging-address=127.0.0.1' "$HOOK" && grep -q -- '--remote-debugging-port=9222' "$HOOK" && pass 'browser automation is explicit opt-in and loopback-only' || fail 'browser opt-in contract'
if grep -qi 'paperclip' "$HOOK" "$RUNNER"; then fail 'Paperclip must not be launched by desktop provisioning'; else pass 'no Paperclip integration'; fi
grep -q 'INSTALL_DOCTOR_KASMVNC_APPLY.*!=.*0' "$HOOK" && pass 'render-only mode cannot mutate active GNOME VNC credentials' || fail 'render-only credential guard missing'
if grep -qiE '(Description=.*Install Doctor|install-doctor-(vnc|kasmvnc|browser)\.service|\.config/install-doctor/remote-desktop|\.local/(share|state)/install-doctor/(remote-desktop|kasmvnc))' "$HOOK" "$RUNNER"; then fail 'provisioner brand leaked into runtime identity'; else pass 'runtime identity is provisioner-neutral'; fi
grep -q '127.0.0.1' "$RUNNER" && grep -q 'KASMVNC_WEBSOCKET_PORT' "$RUNNER" && pass 'configurable loopback KasmVNC' || fail 'runner port/scope contract'
if grep -qi 'legion' "$HOOK" "$RUNNER"; then fail 'Legion-specific assumptions remain'; else pass 'host-neutral implementation'; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/home"
cat > "$TMP/bin/uname" <<'EOF'
#!/usr/bin/env bash
printf 'Linux\n'
EOF
cat > "$TMP/bin/awk" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${TEST_MEM_KIB:-8388608}"
EOF
chmod +x "$TMP/bin/uname" "$TMP/bin/awk"
INSTALL_DOCTOR_MEM_TOTAL_KIB=8388608 HOME="$TMP/home" PATH="$TMP/bin:$PATH" bash "$HOOK" >"$TMP/low.log" 2>&1
[ "$?" -eq 0 ] && grep -qi '16 GiB' "$TMP/low.log" && pass 'below-threshold host skips cleanly' || fail 'low-memory skip'
INSTALL_DOCTOR_KASMVNC=0 HOME="$TMP/home" PATH="$TMP/bin:$PATH" bash "$HOOK" >"$TMP/off.log" 2>&1
[ "$?" -eq 0 ] && pass 'explicit opt-out skips cleanly' || fail 'opt-out skip'

printf 'kasmvnc-live-gnome: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
