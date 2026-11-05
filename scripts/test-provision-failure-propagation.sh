#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROVISIONER="$ROOT_DIR/scripts/provision.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

awk '/^runChezmoi\(\) \{/{copy=1} copy{print} copy && /^\}/{exit}' "$PROVISIONER" > "$TMP_DIR/run-chezmoi.sh"

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/home"
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
  set -u
  logg() { :; }
  detect_os() { printf "%s\n" linux; }
  HEADLESS_INSTALL=true
  KEEP_GOING=
  DEBUG_MODE=
  DEBUG=
  NO_RESTART=true
  source "$1"
  runChezmoi
' _ "$TMP_DIR/run-chezmoi.sh"
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
run = text.index('runChezmoi || CHEZMOI_STATUS=$?')
cleanup = text.index('removePasswordlessSudo', run)
failure_gate = text.index('if [ "$CHEZMOI_STATUS" -ne 0 ]', cleanup)
post = text.index('postProvision', failure_gate)
assert run < cleanup < failure_gate < post
PY

printf 'Provision failure propagation tests passed.\n'
