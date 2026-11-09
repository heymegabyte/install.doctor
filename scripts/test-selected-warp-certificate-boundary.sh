#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"

grep -Fq "const warpSelected = platform === 'darwin' && selectedPackageClosure.includes('warp');" "$PROVISION"
grep -Fq 'if (warpSelected) {' "$PROVISION"
grep -Fq "const macosCertificateSelected = warpSelected && certificateDigest !== 'absent';" "$PROVISION"
grep -Fq 'const macosCertificateTask = macosCertificateSelected ? {' "$PROVISION"
grep -Fq "packageKey: 'warp'" "$PROVISION"
grep -Fq "policy: 'selected-warp-only-v1'" "$PROVISION"
grep -Fq 'if (macosCertificateTask) finalDependencies.push(macosCertificateTask.id);' "$PROVISION"
grep -Fq '...(macosCertificateTask ? [macosCertificateTask] : [])' "$PROVISION"
grep -Fq '...(macosCertificateTask ? {' "$PROVISION"

printf '%s\n' 'selected-warp-certificate-boundary: 9 passed, 0 failed'
