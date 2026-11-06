#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROVISIONER="$ROOT_DIR/scripts/provision.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

awk '/^runChezmoi\(\) \{/{copy=1} copy{print} copy && /^\}/{exit}' "$PROVISIONER" > "$TMP_DIR/run-chezmoi.sh"

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/home" "$TMP_DIR/source"
cat > "$TMP_DIR/bin/chezmoi" <<'SCRIPT'
#!/usr/bin/env bash
exit 7
SCRIPT
cat > "$TMP_DIR/bin/xrandr" <<'SCRIPT'
#!/usr/bin/env bash
exit 1
SCRIPT
chmod +x "$TMP_DIR/bin/chezmoi" "$TMP_DIR/bin/xrandr"

set +e
PATH="$TMP_DIR/bin:$PATH" HOME="$TMP_DIR/home" bash -c '
  set -uo pipefail
  logg() { :; }
  detect_os() { printf "%s\n" linux; }
  loadHomebrew() { :; }
  INSTALL_DOCTOR_CHEZMOI_SOURCE="$2"
  HEADLESS_INSTALL=true
  KEEP_GOING=
  DEBUG_MODE=
  DEBUG=
  NO_RESTART=true
  source "$1"
  runChezmoi
' _ "$TMP_DIR/run-chezmoi.sh" "$TMP_DIR/source"
STATUS=$?
set -e

if [ "$STATUS" -ne 7 ]; then
  printf 'Expected headless Chezmoi failure 7, got %s\n' "$STATUS" >&2
  exit 1
fi

python3 - "$PROVISIONER" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text()
run = text.index('runCanonicalProvisionEngine || CHEZMOI_STATUS=$?')
fallback_gate = text.index('if [ "${INSTALL_DOCTOR_SUDO_FINALIZER_VERIFIED:-false}" != true ]', run)
cleanup = text.index('removePasswordlessSudo', fallback_gate)
failure_gate = text.index('if [ "$CHEZMOI_STATUS" -ne 0 ]', cleanup)
post = text.index('postProvision', failure_gate)
assert run < fallback_gate < cleanup < failure_gate < post
assert 'protected engine evidence does not prove' in text[fallback_gate:failure_gate]
PY

printf 'Provision failure propagation tests passed.\n'
