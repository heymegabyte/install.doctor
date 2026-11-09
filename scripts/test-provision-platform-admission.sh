#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
MATRIX="$ROOT/scripts/platform-support-matrix.json"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT

# shellcheck disable=SC1090
source "$PROVISION"
logg() { printf '%s: %s\n' "$1" "$2" >> "$TMP/log"; }

node - "$MATRIX" > "$TMP/cells.tsv" <<'NODE'
const fs = require('node:fs');
const matrix = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const os = value => ({ macOS: 'macos', Ubuntu: 'ubuntu', Debian: 'debian', Fedora: 'fedora',
  'Arch Linux': 'arch', 'Alpine Linux': 'alpine', Linux: 'linux', 'Fedora Silverblue': 'silverblue',
  'Qubes OS': null, 'Proxmox VE': 'proxmox', 'Ubuntu with Coolify': 'ubuntu',
  'Ubuntu on WSL2': 'ubuntu', Windows: 'windows' }[value]);
for (const cell of matrix.cells) {
  const mapped = cell.role.startsWith('qubes-') ? cell.role : os(cell.os);
  process.stdout.write([mapped, cell.version, cell.arch, cell.environment, cell.role, cell.id, cell.status, cell.limitation].join('\t') + '\n');
}
NODE

while IFS=$'\t' read -r os release arch environment role expected_id expected_status expected_limitation; do
  actual="$(idResolvePlatformAdmission "$os" "$release" "$arch" "$environment" "$role")"
  IFS='|' read -r actual_id actual_status actual_limitation <<< "$actual"
  [ "$actual_id" = "$expected_id" ] && [ "$actual_status" = "$expected_status" ] && [ "$actual_limitation" = "$expected_limitation" ] || {
    printf 'embedded platform policy drifted for %s\n' "$expected_id" >&2; exit 1;
  }
done < "$TMP/cells.tsv"

if idResolvePlatformAdmission ubuntu 99 x64 native ubuntu >/dev/null 2>&1; then
  printf 'unknown tuple was admitted\n' >&2; exit 1
fi

idPlatformMatrixFacts() { printf '%s\n' 'debian|12|x64|container|debian'; }
INSTALL_DOCTOR_CONSENT_BEST_EFFORT=false
if idAdmitPlatform; then printf 'best-effort tuple lacked explicit consent\n' >&2; exit 1; fi
INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true
idAdmitPlatform
[ "$INSTALL_DOCTOR_PLATFORM_CELL" = debian-12-x64-container ]
[ "$INSTALL_DOCTOR_PLATFORM_STATUS" = best-effort ]

idPlatformMatrixFacts() { printf '%s\n' 'debian|12|x64|native|debian'; }
INSTALL_DOCTOR_CONSENT_BEST_EFFORT=false
if idAdmitPlatform; then printf 'native Debian best-effort tuple lacked explicit consent\n' >&2; exit 1; fi
INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true
idAdmitPlatform
[ "$INSTALL_DOCTOR_PLATFORM_CELL" = debian-12-x64-native ]
[ "$INSTALL_DOCTOR_PLATFORM_STATUS" = best-effort ]

idPlatformMatrixFacts() { printf '%s\n' 'proxmox|8|x64|native|proxmox'; }
if idAdmitPlatform; then printf 'unsupported tuple was admitted with consent\n' >&2; exit 1; fi
idPlatformMatrixFacts() { printf '%s\n' 'ubuntu|99|x64|native|ubuntu'; }
if idAdmitPlatform; then printf 'absent tuple was admitted with consent\n' >&2; exit 1; fi

for function_name in detect_os detect_arch detect_release detect_role; do
  fallback="$(awk '/^else$/{seen=1} seen{print} /^fi$/{if(seen) exit}' "$PROVISION")"
  grep -q "^  ${function_name}()" <<< "$fallback" || { printf 'standalone detector lacks %s\n' "$function_name" >&2; exit 1; }
done

grep -q 'Resolving the exact host against signed platform policy.*idResolvePlatform' "$PROVISION"
grep -q 'Authorizing the exact host and recorded consent.*idAuthorizePlatform' "$PROVISION"
resolve_line="$(grep -n 'idRunRequiredProvisionStep "Resolving the exact host' "$PROVISION" | cut -d: -f1)"
configure_line="$(grep -n 'idRunRequiredProvisionStep "Resolving the install plan' "$PROVISION" | cut -d: -f1)"
admit_line="$(grep -n 'idRunRequiredProvisionStep "Authorizing the exact host' "$PROVISION" | cut -d: -f1)"
plan_line="$(grep -n 'Approving and executing one canonical provisioning plan' "$PROVISION" | cut -d: -f1)"
[ "$resolve_line" -lt "$configure_line" ] || { printf 'platform resolution occurs after interactive planning\n' >&2; exit 1; }
[ "$configure_line" -lt "$admit_line" ] || { printf 'platform authorization occurs before consent can be recorded\n' >&2; exit 1; }
[ "$admit_line" -lt "$plan_line" ] || { printf 'platform admission occurs after plan approval\n' >&2; exit 1; }

printf 'provision-platform-admission: pass\n'
