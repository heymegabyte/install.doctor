#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"
CATALOG="$ROOT/packages/control-plane/src/catalog.json"
ENGINE_SRC="$ROOT/packages/installer-engine/src/flatpak-launcher-composition.ts"
GENERATOR="$ROOT/packages/control-plane/scripts/gen-catalog.mjs"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if jq -e '
  ([.[] | select(.flatpakLauncher != null)] | length) > 0 and
  all(.[] | select(.flatpakLauncher != null);
    (.providers | index("flatpak")) != null and
    (.flatpakLauncher.appId | test("^[A-Za-z][A-Za-z0-9_-]*(\\.[A-Za-z][A-Za-z0-9_-]*){2,}$")) and
    (.flatpakLauncher.bin | test("^[a-z0-9][a-z0-9._+\\-]*$")))
' "$CATALOG" >/dev/null; then pass 'signed catalog exposes only bounded Flatpak launcher metadata'; else fail 'catalog Flatpak launcher metadata is missing or unsafe'; fi

grep -Fq 'safeFlatpak' "$GENERATOR" \
  && jq -e 'any(.[]; (.providers | index("flatpak")) != null)' "$CATALOG" >/dev/null \
  && pass 'desired-state catalog preserves Flatpak authority outside the command-not-found index' \
  || fail 'Flatpak provider authority is projected away before load planning'

grep -Fq "command: 'flatpak-launcher-derive'" "$PROVISION" \
  && grep -Fq 'INSTALL_DOCTOR_ENGINE_FLATPAK_LAUNCHERS: migratedFlatpakLauncherPackages.join' "$PROVISION" \
  && grep -Fq '...flatpakLauncherTasks' "$PROVISION" \
  && pass 'provisioning derives, plans, and partitions engine-owned Flatpak launchers' \
  || fail 'provisioning Flatpak launcher cutover wiring is incomplete'

grep -Fq 'process.env.INSTALL_DOCTOR_ENGINE_FLATPAK_LAUNCHERS' "$INSTALLX" \
  && grep -Fq 'if (engineOwned.has(x.listKey)) return false' "$INSTALLX" \
  && pass 'legacy Installx skips only exact engine-owned Flatpak launcher package keys' \
  || fail 'legacy Installx still races engine-owned Flatpak launcher writes'

grep -Fq "dependencies: ['desired.packages', 'installer.flatpak-launcher-directory']" "$ENGINE_SRC" \
  && grep -Fq "compensation: 'configuration'" "$ENGINE_SRC" \
  && grep -Fq "flatpakPath: input.flatpakExecutable.path" "$ENGINE_SRC" \
  && pass 'Flatpak launcher activation binds package ordering, executable authority, and compensation' \
  || fail 'Flatpak launcher task ordering, executable authority, or compensation is missing'

printf 'flatpak-launcher-cutover: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
