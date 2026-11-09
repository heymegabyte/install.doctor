#!/usr/bin/env bash
# Contract gate for the canonical browserless enrollment instructions. This
# executes the documented target-side command against a bounded local fixture;
# the human approval step deliberately remains on a separate trusted device.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$ROOT/docs/desktop-tools/README.md"
PAIR="$ROOT/home/dot_local/bin/executable_desktop-tools-pair"
CLI="$ROOT/home/dot_local/bin/executable_desktop-tools"
CONTROL="$ROOT/packages/control-plane/src/index.ts"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*"; F=$((F + 1)); }

documented_command="$(awk '
  /^## Headless enrollment and recovery$/ { section=1; next }
  section && /^```bash$/ { fence=1; next }
  section && fence && /^```$/ { exit }
  section && fence { print }
' "$DOC")"

if [ "$documented_command" = 'HEADLESS_INSTALL=true desktop-tools-pair' ]; then
  pass 'guide contains one exact browserless target command'
else
  fail "unexpected documented command: ${documented_command:-<missing>}"
fi

if [ -x "$PAIR" ] && [ -x "$CLI" ]; then
  pass 'documented pairing and status executables ship in the managed source'
else
  fail 'documented pairing or status executable is absent'
fi

if grep -Fq "app.post('/api/devices/pair/start'" "$CONTROL" \
  && grep -Fq "app.get('/api/devices/pair/poll'" "$CONTROL" \
  && grep -Fq "app.get('/pair'" "$CONTROL" \
  && grep -Fq '"$u/api/devices/pair/start"' "$PAIR" \
  && grep -Fq '"$u/api/devices/pair/poll"' "$PAIR"; then
  pass 'client start/poll paths and separate-browser approval route agree'
else
  fail 'documented enrollment path has drifted from client or control-plane routes'
fi

if grep -Fqi 'separate trusted phone or computer' "$DOC" \
  && grep -Fq 'A QR code or opened URL is not' "$DOC" \
  && grep -Fq 'approval. Deny the request if any value differs' "$DOC" \
  && grep -Fq 'must not be described as production enrollment' "$DOC"; then
  pass 'guide requires external human approval and preserves pre-production honesty'
else
  fail 'guide lost its external approval or availability boundary'
fi

fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/home"
printf '%s\n' '#!/usr/bin/env bash' \
  'case " $* " in' \
  '  *"/api/devices/pair/start"*) printf '\''%s\n'\'' '\''{"code":"ABCD-EFGH-JKLM","verifyUrl":"https://desktop.tools/pair?code=ABCD-EFGH-JKLM"}'\'' ;;' \
  '  *"/api/devices/pair/poll"*) printf '\''%s\n'\'' '\''{"status":"denied"}'\'' ;;' \
  '  *) exit 22 ;;' \
  'esac' >"$fixture/bin/curl"
printf '%s\n' '#!/usr/bin/env bash' 'touch "$BROWSER_SENTINEL"' >"$fixture/bin/open"
printf '%s\n' '#!/usr/bin/env bash' 'exit 127' >"$fixture/bin/gum"
cp "$fixture/bin/open" "$fixture/bin/xdg-open"
chmod 0700 "$fixture/bin/curl" "$fixture/bin/open" "$fixture/bin/xdg-open" "$fixture/bin/gum"

rc=0
HOME="$fixture/home" PATH="$fixture/bin:$PATH" BROWSER_SENTINEL="$fixture/browser-opened" \
  DESKTOP_TOOLS_TOKEN_PATH="$fixture/home/.config/desktop-tools/device-token" \
  DESKTOP_TOOLS_DEVICE_FINGERPRINT_PATH="$fixture/home/.config/desktop-tools/device-fingerprint" \
  HEADLESS_INSTALL=true DESKTOP_TOOLS_PAIR_TIMEOUT=2 DESKTOP_TOOLS_PAIR_INTERVAL=1 \
  bash "$PAIR" >"$fixture/output" 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && [ ! -e "$fixture/browser-opened" ] \
  && grep -Fq 'APPROVE AT:    https://desktop.tools/pair?code=ABCD-EFGH-JKLM' "$fixture/output" \
  && grep -Fq 'ended without authorization: denied' "$fixture/output" \
  && [ ! -e "$fixture/home/.config/desktop-tools/device-token" ]; then
  pass 'documented headless command prints remote approval URL, opens no browser, and persists no denied credential'
else
  fail 'browserless fixture opened a browser, hid approval, or persisted denied authority'
  sed -n '1,30p' "$fixture/output" >&2
  find "$fixture/home" -type f -maxdepth 5 -print >&2 2>/dev/null || true
fi

printf 'desktop-tools headless enrollment docs: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
