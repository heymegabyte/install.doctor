#!/usr/bin/env bash
set -euo pipefail

target=home/dot_local/bin/executable_get-secret
grep -Fq 'const secretPath = `/hosts/${hostname}`' "$target"
! grep -Fq "'/']" "$target"
grep -Fq 'return null' "$target"
grep -Fq 'must never silently inherit' "$target"
grep -Fq -- '--env=prod' "$target"
! grep -Fq 'process.env.INFISICAL_ENVIRONMENT' "$target"
grep -Fq "INSTALL_DOCTOR_SECRET_BACKEND || 'auto'" "$target"
grep -Fq "backend === 'infisical'" "$target"
grep -Fq "['auto', 'local', 'infisical'].includes(backend)" "$target"
grep -Fq "const offlineSecretNames" "$target"
grep -Fq "offlineSecretNames.has(secretName)" "$target"
grep -Fq "backend === 'auto'" "$target"
grep -Fq 'return getInfisicalSecret(secretName)' "$target"
if grep -Fq 'process.env[secretName]' "$target"; then
  printf 'get-secret accepts an ambient variable as authoritative secret input\n' >&2
  exit 1
fi
! grep -Fq 'environment variables, or Chezmoi Age-encrypted host store' "$target"
zfs_hook=home/dot_local/bin/post-installx/executable_post-zfs-prep.sh
! grep -Fq 'infisical secrets get' "$zfs_hook"
grep -Fq 'get-secret SUDO_PASSWORD' "$zfs_hook"
echo 'get-secret-fail-closed: PASS'
