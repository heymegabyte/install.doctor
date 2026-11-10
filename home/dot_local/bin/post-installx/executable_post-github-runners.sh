#!/usr/bin/env bash
# @file executable_post-github-runners.sh
# @description Fail-closed boundary for the not-yet-migrated self-hosted runner capability.
set -euo pipefail

log() { printf 'github-runners: %s\n' "$*" >&2; }

if [ "$(uname -s 2>/dev/null)" != Linux ]; then
  log 'self-hosted runner fleet provisioning is inapplicable on this platform'
  exit 0
fi

case "${GITHUB_RUNNER_COUNT:-0}" in
  ''|*[!0-9]*) log 'GITHUB_RUNNER_COUNT must be a non-negative integer'; exit 2 ;;
  0) log 'no self-hosted runner fleet was selected'; exit 0 ;;
esac

# The retired implementation accepted a registration token in the environment,
# interpolated it into `bash -c`, and installed a cleanup hook that recursively
# deleted a caller-selected RUNNER_TEMP. Until enrollment, service creation,
# resource limits, and cleanup are represented by typed engine operations with
# a non-argv secret channel and owned-path validation, no mutation is allowed.
log 'self-hosted runner provisioning is unsupported until typed enrollment and owned cleanup operations are available'
exit 20
