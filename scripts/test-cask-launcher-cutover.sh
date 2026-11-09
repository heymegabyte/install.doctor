#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"
CATALOG="$ROOT/packages/control-plane/src/catalog.json"
ENGINE_SRC="$ROOT/packages/installer-engine/src/cask-launcher-composition.ts"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if jq -e '
  ([.[] | select(.caskLauncher != null)] | length) > 0 and
  all(.[] | select(.caskLauncher != null);
    (.providers | index("cask")) != null and
    (.caskLauncher.appBundle | test("^[A-Za-z0-9][A-Za-z0-9 ._+()\\-]*\\.app$")) and
    (.caskLauncher.bin | test("^[a-z0-9][a-z0-9._+\\-]*$")))
' "$CATALOG" >/dev/null; then pass 'signed catalog exposes only bounded cask launcher metadata'; else fail 'catalog cask launcher metadata is missing or unsafe'; fi

grep -Fq "command: 'cask-launcher-derive'" "$PROVISION" \
  && grep -Fq 'INSTALL_DOCTOR_ENGINE_CASK_LAUNCHERS: migratedLauncherPackages.join' "$PROVISION" \
  && grep -Fq '...caskLauncherTasks' "$PROVISION" \
  && pass 'provisioning derives, plans, and partitions engine-owned cask launchers' \
  || fail 'provisioning cask launcher cutover wiring is incomplete'

grep -Fq "process.env.INSTALL_DOCTOR_ENGINE_CASK_LAUNCHERS" "$INSTALLX" \
  && grep -Fq 'if (engineOwned.has(x.listKey)) return false' "$INSTALLX" \
  && pass 'legacy Installx skips only the exact engine-owned launcher package keys' \
  || fail 'legacy Installx still races engine-owned cask launcher writes'

grep -Fq "dependencies: ['desired.packages', 'installer.cask-launcher-directory']" "$ENGINE_SRC" \
  && grep -Fq "compensation: 'configuration'" "$ENGINE_SRC" \
  && pass 'launcher activation is ordered after package install and uses reversible configuration authority' \
  || fail 'launcher task ordering or compensation authority is missing'

printf 'cask-launcher-cutover: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
