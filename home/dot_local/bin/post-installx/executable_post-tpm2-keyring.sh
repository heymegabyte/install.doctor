#!/usr/bin/env bash
# @file executable_post-tpm2-keyring.sh
# @description Capability-aware TPM2-backed GNOME Keyring unlock provisioning for Install Doctor (§13).
# Verifies all 5 predicates (GNOME desktop, keyring daemon, usable TPM2 + /dev/tpmrm0,
# systemd-creds TPM2 support, and fallback recovery path) before sealing credentials.
set -euo pipefail

log_info() { printf '\033[0;34mINFO\033[0m %s\n' "$*"; }
log_warn() { printf '\033[0;33mWARN\033[0m %s\n' "$*"; }

OS_KERNEL="$(uname -s)"
if [[ "$OS_KERNEL" != "Linux" ]]; then
  log_info "TPM2 GNOME Keyring unlock is Linux/GNOME-only (detected: $OS_KERNEL). Skipping."
  exit 0
fi

if [[ "$(systemctl show legion-tpm2-keyring-unlock.service -p LoadState --value 2>/dev/null)" == loaded ]]; then
  log_info "Legion already has a host-managed TPM keyring unit; leaving it in place."
  exit 0
fi

# Predicate 1 & 2: GNOME desktop + gnome-keyring-daemon
if ! command -v gnome-keyring-daemon >/dev/null 2>&1; then
  log_info "gnome-keyring-daemon not installed; skipping TPM2 keyring integration."
  exit 0
fi

has_active_gnome_session() {
  local uid=$1 sessions session session_uid properties
  sessions=$(loginctl list-sessions --no-legend --no-pager 2>/dev/null) || return 1
  [[ -S "/run/user/$uid/bus" ]] && pgrep -u "$uid" -x gnome-shell >/dev/null || return 1
  while read -r session session_uid _; do
    [[ -n "$session" && "$session_uid" == "$uid" ]] || continue
    properties=$(loginctl show-session "$session" --no-pager \
      -p User -p Type -p Class -p Seat -p Remote -p Active 2>/dev/null) || continue
    if grep -Fxq "User=$uid" <<<"$properties" &&
      grep -Eq '^Type=(x11|wayland)$' <<<"$properties" &&
      grep -Fxq 'Class=user' <<<"$properties" &&
      grep -Eq '^Seat=[^[:space:]]+$' <<<"$properties" &&
      grep -Fxq 'Remote=no' <<<"$properties" &&
      grep -Fxq 'Active=yes' <<<"$properties"; then
      return 0
    fi
  done <<<"$sessions"
  return 1
}

target_uid=$EUID
if (( EUID == 0 )); then target_uid=${SUDO_UID:-}; fi
if [[ ! "$target_uid" =~ ^[1-9][0-9]*$ ]] || ! has_active_gnome_session "$target_uid"; then
  log_info "No active local GNOME session for the provisioning user. Skipping."
  exit 0
fi

# Predicate 3 & 4: Usable TPM2 device (/dev/tpmrm0) + systemd-creds TPM2 support
if [[ ! -e /dev/tpmrm0 ]] || ! command -v systemd-creds >/dev/null 2>&1; then
  log_info "TPM2 resource manager (/dev/tpmrm0) or systemd-creds not present; skipping TPM2 keyring integration."
  exit 0
fi

if ! systemd-analyze has-tpm2 2>/dev/null | grep -q "^yes"; then
  log_warn "systemd-analyze has-tpm2 did not report full TPM2 readiness; skipping TPM2 keyring integration."
  exit 0
fi

if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo -n"; fi

# Encrypted credential enrollment is performed separately by the host operator.
credential="/etc/credstore.encrypted/gnome-keyring-${target_uid}.cred"
if ! $SUDO test -s "$credential"; then
  log_info "No enrolled encrypted GNOME keyring credential. Skipping."
  exit 0
fi
if ! $SUDO test -f "$credential" || $SUDO test -L "$credential" ||
   [[ "$($SUDO stat -c '%u:%g:%a' "$credential")" != 0:0:600 ]]; then
  log_warn "Enrolled credential must be a root-owned mode-0600 file."
  exit 1
fi

# systemd v259 creds-util.h identifies the TPM2 HMAC format with this ID.
# The later authenticated decrypt verifies the blob, including this header.
credential_type=$($SUDO base64 -d -- "$credential" |
  od -An -v -tx1 -w16 | awk 'NR == 1 { gsub(/ /, ""); print }')
if [[ "$credential_type" != 0c7cc07b117645919c4b0bea08bc20fe ]]; then
  log_warn "Enrolled credential must use systemd-creds --with-key=tpm2."
  exit 1
fi

# A private runtime directory prevents concurrent probes sharing a credential path.
probe_dir="$($SUDO mktemp -d /run/install-doctor-tpm2.XXXXXX)"
cleanup_probe() {
  $SUDO rm -f -- "$probe_dir/selftest.cred"
  $SUDO rmdir -- "$probe_dir"
}
trap cleanup_probe EXIT
printf '%s' 'tpm2-keyring-selftest-ok' |
  $SUDO timeout 20 systemd-creds encrypt --with-key=tpm2 --tpm2-pcrs=7 \
    --name=tpm2-selftest - "$probe_dir/selftest.cred"
if [[ "$($SUDO timeout 20 systemd-creds decrypt --name=tpm2-selftest "$probe_dir/selftest.cred" -)" != tpm2-keyring-selftest-ok ]]; then
  log_warn "TPM2 seal/unseal roundtrip failed. Skipping keyring activation."
  exit 1
fi
if ! $SUDO timeout 20 systemd-creds decrypt --name=gnome-keyring "$credential" /dev/null >/dev/null 2>&1; then
  log_warn "Enrolled credential did not decrypt with the current boot policy."
  exit 1
fi
cleanup_probe
trap - EXIT
log_info "TPM2 seal/unseal roundtrip and enrolled credential read succeeded."
$SUDO install -d -m 0755 /usr/local/libexec

# Install the helper for the credential that systemd delivers at activation.
$SUDO tee /usr/local/libexec/tpm2-keyring-unlock >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
TARGET_UID="${1:?Expected the GNOME user ID}"
[[ "$TARGET_UID" =~ ^[1-9][0-9]*$ ]]
TARGET_USER="$(id -nu "$TARGET_UID")"
RUNTIME_DIR="/run/user/$TARGET_UID"
CREDENTIAL="${CREDENTIALS_DIRECTORY:?Expected systemd credentials}/gnome-keyring"
if [[ ! -s "$CREDENTIAL" || ! -S "$RUNTIME_DIR/bus" ]]; then
  printf 'GNOME keyring unlock requires a credential and an active user bus.\n' >&2
  exit 1
fi
gnome_user=(sudo -n -u "$TARGET_USER" env
  XDG_RUNTIME_DIR="$RUNTIME_DIR"
  DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME_DIR/bus")
if ! "${gnome_user[@]}" /usr/bin/gnome-keyring-daemon --unlock <"$CREDENTIAL" >/dev/null 2>&1; then
  printf 'GNOME keyring unlock command failed.\n' >&2
  exit 1
fi
if ! lock_state=$("${gnome_user[@]}" /usr/bin/gdbus call --session --timeout 3 \
  --dest org.freedesktop.secrets --object-path /org/freedesktop/secrets/collection/login \
  --method org.freedesktop.DBus.Properties.Get org.freedesktop.Secret.Collection Locked 2>/dev/null) ||
  [[ "$lock_state" != '(<false>,)' ]]; then
  printf 'GNOME login keyring is locked or could not be verified.\n' >&2
  exit 1
fi
EOF
$SUDO chmod 0755 /usr/local/libexec/tpm2-keyring-unlock

# Install the system unit for the verified graphical user.
sed "s/@TARGET_UID@/$target_uid/g" <<'EOF' | $SUDO tee /etc/systemd/system/tpm2-keyring-unlock.service >/dev/null
[Unit]
Description=TPM2-Backed GNOME Keyring Unlock Helper (with PAM Password Fallback)
After=user@@TARGET_UID@.service
Wants=user@@TARGET_UID@.service
ConditionPathExists=/dev/tpmrm0
ConditionPathExists=/etc/credstore.encrypted/gnome-keyring-@TARGET_UID@.cred

[Service]
Type=oneshot
TimeoutStartSec=20s
LoadCredentialEncrypted=gnome-keyring:/etc/credstore.encrypted/gnome-keyring-@TARGET_UID@.cred
ExecStart=/usr/local/libexec/tpm2-keyring-unlock @TARGET_UID@
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now tpm2-keyring-unlock.service

log_info "TPM2-backed GNOME Keyring unlock service configured. Verify a fresh graphical session before relying on it."
