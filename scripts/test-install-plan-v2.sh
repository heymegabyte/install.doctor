#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT

sed -n '/^writeInstallPlan() {/,/^configureInstallPlan() {/p' "$PROVISION" | sed '$d' > "$TMP/write-plan.sh"

export HOME="$TMP/home" XDG_STATE_HOME="$TMP/state"
mkdir -p "$HOME" "$XDG_STATE_HOME"
export INSTALL_DOCTOR_ROLE=workstation INSTALL_DOCTOR_CAPABILITY=developer INSTALL_DOCTOR_NETWORK=none
export SOFTWARE_GROUP=Minimal INSTALL_DOCTOR_USER=fixture INSTALL_DOCTOR_OFFLINE=false INSTALL_DOCTOR_CONCURRENCY=4
export INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false
export INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true
export INSTALL_DOCTOR_PLATFORM_CELL=debian-12-x64-container INSTALL_DOCTOR_PLATFORM_STATUS=best-effort
export INSTALL_DOCTOR_PLATFORM_OS=debian INSTALL_DOCTOR_PLATFORM_RELEASE=12 INSTALL_DOCTOR_PLATFORM_ARCH=x64
export INSTALL_DOCTOR_PLATFORM_ENVIRONMENT=container INSTALL_DOCTOR_PLATFORM_ROLE=debian
export INSTALL_DOCTOR_PLATFORM_LIMITATION='Fixture lifecycle evidence is incomplete.'
export INSTALL_DOCTOR_SUDO_PREEXISTING=false
export INSTALL_DOCTOR_SELECTED_PACKAGES='zeta,alpha,zeta'
export INSTALL_DOCTOR_SELECTED_SERVICES='worker,api,worker'
export INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS='web,developer,web'
export INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS='installx,chezmoi,installx'

source "$TMP/write-plan.sh"
logg() { :; }
detect_os() { printf 'linux\n'; }
writeInstallPlan
node - "$INSTALL_DOCTOR_PLAN" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.schemaVersion !== 2) throw new Error('install plan is not schema v2');
const expected = {
  selectedPackages: ['alpha', 'zeta'], selectedServices: ['api', 'worker'],
  selectedSupportedPaths: ['developer', 'web'], lazyResolverRequirements: ['chezmoi', 'installx'],
};
for (const [key, list] of Object.entries(expected)) {
  if (JSON.stringify(value[key]) !== JSON.stringify(list)) throw new Error(`${key} is not canonical`);
}
NODE

if INSTALL_DOCTOR_SELECTED_PACKAGES='bad key' INSTALL_DOCTOR_PLAN='' writeInstallPlan >/dev/null 2>&1; then
  printf 'invalid selected package grammar was accepted\n' >&2
  exit 1
fi

resolver_overflow="$(node -e 'process.stdout.write(Array.from({length:129},(_,i)=>`r${i}`).join(","))')"
if INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS="$resolver_overflow" INSTALL_DOCTOR_PLAN='' writeInstallPlan >/dev/null 2>&1; then
  printf 'resolver requirement count bound was not enforced\n' >&2
  exit 1
fi

grep -q 'INSTALL_DOCTOR_USER INSTALL_DOCTOR_SELECTED_SERVICES INSTALL_DOCTOR_SELECTED_PACKAGES' "$PROVISION"
grep -q 'INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS' "$PROVISION"
operation_environment="$(sed -n '/^const operationEnvironment = {/,/^};$/p' "$PROVISION")"
# Package and service selections are execution authority for the catalog and
# software-group reconcilers. Supported-path and resolver intent remain
# planning-only and must not leak into operation subprocesses.
if printf '%s\n' "$operation_environment" | grep -Eq 'INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS|INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS'; then
  printf 'planning-only selected intent leaked into operation environments\n' >&2
  exit 1
fi
printf '%s\n' "$operation_environment" | grep -q 'INSTALL_DOCTOR_SELECTED_PACKAGES'
printf '%s\n' "$operation_environment" | grep -q 'INSTALL_DOCTOR_SELECTED_SERVICES'

fake_engine="$TMP/engine.mjs"
printf '#!/usr/bin/env node\nprocess.exit(99)\n' > "$fake_engine"
chmod 0700 "$fake_engine"
bad_plan="$TMP/bad-plan.json"
node - "$bad_plan" <<'NODE'
const fs = require('node:fs');
fs.writeFileSync(process.argv[2], `${JSON.stringify({
  schemaVersion: 2, host: { hostname: 'fixture', os: 'linux' }, role: 'workstation', capability: 'minimal',
  network: 'none', softwareGroup: 'Minimal', installUser: 'fixture', offline: false, concurrency: 2,
  selectedPackages: [], selectedServices: [], selectedSupportedPaths: [], lazyResolverRequirements: [],
  consents: { privileged: true, network: false, bestEffort: true },
  platformAdmission: { policyRevision: 'platform-support-matrix-v1', cellId: 'debian-12-x64-container', status: 'best-effort',
    os: 'debian', release: '12', arch: 'x64', environment: 'container', role: 'debian', limitation: 'Fixture lifecycle evidence is incomplete.' },
  privilegeContext: { sudoPreexisting: false },
  createdAt: new Date().toISOString(), unexpected: true,
})}\n`, { mode: 0o600 });
NODE

if HOME="$HOME" XDG_STATE_HOME="$XDG_STATE_HOME" INSTALL_DOCTOR_ENGINE_PATH="$fake_engine" \
  INSTALL_DOCTOR_ENGINE_SHA256="$(shasum -a 256 "$fake_engine" | awk '{print $1}')" INSTALL_DOCTOR_ENGINE_NODE_MIN=22 \
  INSTALL_DOCTOR_RELEASE_ID=fixture INSTALL_DOCTOR_PLAN="$bad_plan" \
  bash -c 'source "$1"; runCanonicalProvisionEngine --plan-only' _ "$PROVISION" >/dev/null 2>&1; then
  printf 'strict raw-plan validation accepted an unknown field\n' >&2
  exit 1
fi

printf 'install-plan-v2: pass\n'
