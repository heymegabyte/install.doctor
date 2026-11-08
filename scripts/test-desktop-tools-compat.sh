#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT="$ROOT/home/dot_local/bin/executable_desktop-tools"
AID="$ROOT/home/dot_local/bin/executable_aid"
PAIR="$ROOT/home/dot_local/bin/executable_aid-pair"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*"; F=$((F + 1)); }

for file in "$CLIENT" "$AID" "$PAIR"; do
  if bash -n "$file"; then pass "$(basename "$file") parses"; else fail "$(basename "$file") does not parse"; fi
done

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/home/.config/aid" "$fixture/state/install.doctor"
printf 'legacy-token\n' >"$fixture/home/.config/aid/device-token"
printf 'legacy-environment\n' >"$fixture/home/.config/aid/ENVIRONMENT.md"
before="$(find "$fixture" -type f -exec shasum -a 256 {} \; | LC_ALL=C sort)"
first="$(HOME="$fixture/home" XDG_STATE_HOME="$fixture/state" bash "$CLIENT" migrate --preview)"
second="$(HOME="$fixture/home" XDG_STATE_HOME="$fixture/state" bash "$CLIENT" migrate --preview)"
after="$(find "$fixture" -type f -exec shasum -a 256 {} \; | LC_ALL=C sort)"

if [ "$first" = "$second" ]; then pass 'migration preview is deterministic'; else fail 'migration preview changed on second run'; fi
if [ "$before" = "$after" ]; then pass 'migration preview does not modify legacy state'; else fail 'migration preview modified legacy state'; fi
if printf '%s\n' "$first" | grep -Fq "$fixture/home/.config/aid/device-token" \
  && printf '%s\n' "$first" | grep -Fq 'preserve-and-read-fallback'; then
  pass 'migration preview names legacy token and preservation action'
else
  fail 'migration preview omitted legacy state or preservation action'
fi
if [ ! -e "$fixture/home/.config/desktop-tools" ] && [ ! -e "$fixture/state/desktop-tools" ]; then
  pass 'migration preview creates no canonical state'
else
  fail 'migration preview created canonical state'
fi

stub="$fixture/desktop-tools"
printf '#!/usr/bin/env bash\nprintf "delegated:%%s\\n" "$*"\n' >"$stub"
chmod +x "$stub"
delegated="$(HOME="$fixture/home" DESKTOP_TOOLS_BIN="$stub" bash "$AID" status 2>/dev/null)"
if [ "$delegated" = 'delegated:status' ]; then pass 'aid delegates argv to desktop-tools'; else fail "aid delegation output: $delegated"; fi

pair_stub="$fixture/desktop-tools-pair"
printf '#!/usr/bin/env bash\nprintf "paired:%%s\\n" "$*"\n' >"$pair_stub"
chmod +x "$pair_stub"
paired="$(HOME="$fixture/home" DESKTOP_TOOLS_PAIR_BIN="$pair_stub" bash "$PAIR" --headless 2>/dev/null)"
if [ "$paired" = 'paired:--headless' ]; then pass 'aid-pair delegates argv to desktop-tools-pair'; else fail "aid-pair delegation output: $paired"; fi

printf 'desktop-tools compatibility: %s passed, %s failed\n' "$P" "$F"
[ "$F" -eq 0 ]
