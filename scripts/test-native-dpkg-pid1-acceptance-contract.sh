#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRIVER="$ROOT/scripts/run-native-dpkg-pid1-acceptance.sh"
FIXTURE="$ROOT/packages/installer-engine/test/fixtures/native-dpkg-pid1/acceptance.mjs"
DOCKERFILE="$ROOT/packages/installer-engine/test/fixtures/native-dpkg-pid1/Dockerfile"
WORKFLOW="$ROOT/.github/workflows/native-dpkg-pid1-acceptance.yml"
PASSED=0
FAILED=0

pass() { printf 'PASS %s\n' "$*"; PASSED=$((PASSED + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; FAILED=$((FAILED + 1)); }
check() { local label="$1"; shift; if "$@"; then pass "$label"; else fail "$label"; fi; }
hasNoDeployCommands() { ! grep -Eq 'wrangler deploy|git push|release activate' "$1"; }

check 'driver exists' test -f "$DRIVER"
check 'fixture exists' test -f "$FIXTURE"
check 'Dockerfile exists' test -f "$DOCKERFILE"
check 'workflow exists' test -f "$WORKFLOW"
check 'pinned Debian-family base image' grep -Eq '^FROM node:24-bookworm@sha256:[a-f0-9]{64}$' "$DOCKERFILE"
check 'fixture has OpenPGP and xz authority tooling' grep -Eq 'gnupg.*xz-utils|xz-utils.*gnupg' "$DOCKERFILE"
check 'container has real PID1 systemd' grep -Fq -- '/sbin/init' "$DRIVER"
check 'runtime execution has no network' grep -Fq -- '--network none' "$DRIVER"
check 'runtime authority tmpfs permits the verified broker executable' grep -Fq -- '--tmpfs /run:rw,nosuid,nodev,exec,mode=755' "$DRIVER"
check 'container is always removed' grep -Fq 'docker rm --force' "$DRIVER"
check 'fixed enrolled non-root uid is required' grep -Fq 'enrolled_uid=1000' "$DRIVER"
check 'enrolled identity is resolved from container passwd authority' grep -Fq 'getent passwd "$enrolled_uid"' "$DRIVER"
check 'private enrolled-user runtime is created' grep -Fq 'install -d -o "$enrolled_uid" -g "$enrolled_gid" -m 0700 /run/user/1000' "$DRIVER"
check 'root-owned broker runtime is group-traversable and non-writable' grep -Fq 'install -d -o 0 -g "$enrolled_gid" -m 0750 /run/install.doctor /run/install.doctor/broker' "$DRIVER"
check 'production broker namespace is protected and traversable' grep -Fq 'install -d -o 0 -g "$enrolled_gid" -m 0750 /run/desktop-tools /run/desktop-tools/broker' "$DRIVER"
check 'production authority namespace is root-owned and traversable' grep -Fq 'install -d -o 0 -g 0 -m 0711 /run/desktop-tools/authority' "$DRIVER"
check 'runtime ownership and modes are verified numerically' grep -Fq 'stat -c %u:%g:%a /run/install.doctor/broker' "$DRIVER"
check 'enrolled peer capability is exercised under uid 1000' grep -Fq 'setpriv --reuid="$enrolled_uid" --regid="$enrolled_gid" --init-groups --reset-env' "$DRIVER"
check 'broker runtime rejects enrolled-user writes' grep -Fq '[ ! -w /run/install.doctor/broker ]' "$DRIVER"
check 'PID1 is asserted' grep -Fq "readFile('/proc/1/comm'" "$FIXTURE"
check 'network isolation is asserted' grep -Fq 'assertNativeDpkgNetworkDenied' "$FIXTURE"
check 'NET_ADMIN is removed from the acceptance process' grep -Fq -- '--bounding-set=-net_admin' "$DRIVER"
check 'real package is control-inspected' grep -Fq 'inspectNativeDebianPackage' "$FIXTURE"
check 'ephemeral repository is OpenPGP signed' grep -Fq -- '--clear-sign' "$FIXTURE"
check 'real InRelease metadata is verified' grep -Fq 'verifyDebianRepositoryMetadata' "$FIXTURE"
check 'production gpgv verifier is used' grep -Fq 'createDefaultDebianMetadataVerifier' "$FIXTURE"
check 'repository verification is receipted' grep -Fq 'repositoryMetadataVerified: true' "$FIXTURE"
check 'repository substitution is rejected and receipted' grep -Fq 'repositoryTamperRejected: repositoryAuthority.tamperRejected' "$FIXTURE"
check 'real native runtime is used' grep -Fq 'createNativeDpkgTransactionRuntime' "$FIXTURE"
check 'real Go broker is built into fixture' grep -Fq 'go build -trimpath' "$DOCKERFILE"
check 'production broker worker bundle is used' grep -Fq 'desktop-tools-privileged-worker.mjs' "$FIXTURE"
check 'production broker controller is used' grep -Fq 'runPrivilegedBrokerController' "$FIXTURE"
check 'production broker client is used' grep -Fq 'createPrivilegedBrokerNativeRuntime' "$FIXTURE"
check 'schema-v9 release authority is generated' grep -Fq "'schema_version=9'" "$FIXTURE"
check 'signed-device broker approval is generated' grep -Fq "approvalMode: 'signed-device'" "$FIXTURE"
check 'release signer delegation is exact' grep -Fq 'brokerApprovalDelegationDigest' "$FIXTURE"
check 'broker client executes under enrolled uid' grep -Fq '`--reuid=${enrolledUid}`' "$FIXTURE"
check 'broker lifecycle asserts exact statuses' grep -Fq "check: 'needed', apply: 'applied', verify: 'verified'" "$FIXTURE"
check 'broker authority retirement is asserted' grep -Fq 'brokerAuthorityRetired' "$FIXTURE"
check 'broker transaction completion is asserted' grep -Fq 'brokerTransactionCompleted' "$FIXTURE"
check 'interruption is boundary-controlled' grep -Fq 'controller.abort' "$FIXTURE"
check 'resume is asserted' grep -Fq "resumeConfigureOnly" "$FIXTURE"
check 'second apply is asserted unchanged' grep -Fq "unchangedSecondApply" "$FIXTURE"
check 'policy restoration is asserted' grep -Fq "policyRestoredExactly" "$FIXTURE"
check 'service restoration is asserted' grep -Fq "serviceRestoredExactly" "$FIXTURE"
check 'trigger state is asserted' grep -Fq "noPendingTriggers" "$FIXTURE"
check 'machine-readable evidence is emitted' grep -Fq "schemaVersion: 1" "$FIXTURE"
check 'workflow is bounded' grep -q '^    timeout-minutes: 20$' "$WORKFLOW"
check 'workflow is non-deploying' hasNoDeployCommands "$WORKFLOW"
check 'driver syntax' bash -n "$DRIVER"

printf 'native-dpkg-pid1-acceptance-contract: %d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
