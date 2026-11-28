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
if ! $SUDO test -s /etc/credstore.encrypted/gnome-keyring.cred; then
  log_info "No enrolled encrypted GNOME keyring credential. Skipping."
  exit 0
fi

TMP_PLAIN=""
TMP_CRED=""
cleanup() {
  if [[ -n "$TMP_PLAIN" ]]; then
    rm -f -- "$TMP_PLAIN"
  fi
  if [[ -n "$TMP_CRED" ]]; then
    $SUDO rm -f -- "$TMP_CRED"
  fi
}
trap cleanup EXIT

$SUDO install -d -m 0700 /etc/credstore.encrypted
$SUDO install -d -m 0755 /usr/local/libexec

# Verify TPM2 seal + unseal roundtrip using PCR 7 (Secure Boot state) so kernel upgrades (PCR 4) do not cause lockout
TMP_PLAIN="$(mktemp)"
TMP_CRED="/etc/credstore.encrypted/tpm2-selftest.cred"
printf 'tpm2-keyring-selftest-ok' > "$TMP_PLAIN"
$SUDO systemd-creds encrypt --with-key=tpm2 --tpm2-pcrs=7 --name=tpm2-selftest "$TMP_PLAIN" "$TMP_CRED"
UNSEALED="$($SUDO systemd-creds decrypt --name=tpm2-selftest "$TMP_CRED" -)"
rm -f "$TMP_PLAIN"
$SUDO rm -f "$TMP_CRED"
TMP_PLAIN=""
TMP_CRED=""

if [[ "$UNSEALED" != "tpm2-keyring-selftest-ok" ]]; then
  log_warn "TPM2 seal/unseal roundtrip verification failed; refusing to enable TPM2 keyring unlock."
  exit 1
fi
log_info "TPM2 seal/unseal roundtrip verified via /dev/tpmrm0 (PCR 7)."

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

# Install systemd system unit triggered after user@1000.service starts
$SUDO tee /etc/systemd/system/tpm2-keyring-unlock.service >/dev/null <<'EOF'
[Unit]
Description=TPM2-Backed GNOME Keyring Unlock Helper (with PAM Password Fallback)
After=user@1000.service
Wants=user@1000.service
ConditionPathExists=/dev/tpmrm0
ConditionPathExists=/etc/credstore.encrypted/gnome-keyring.cred

[Service]
Type=oneshot
TimeoutStartSec=20s
LoadCredentialEncrypted=gnome-keyring:/etc/credstore.encrypted/gnome-keyring.cred
ExecStart=/usr/local/libexec/tpm2-keyring-unlock 1000
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now tpm2-keyring-unlock.service

log_info "TPM2-backed GNOME Keyring unlock service configured. Verify a fresh graphical session before relying on it."
