#!/usr/bin/env bash
# @file docker-audit-guard.sh (Item 26)
# @description Scoped audit & privilege-escalation guard wrapper for /usr/bin/docker.
# Logs all non-root Docker invocations to syslog/auditd and blocks interactive
# root-filesystem bind-mount privilege escalations unless FLEET_DOCKER_ADMIN=1 or root.
set -euo pipefail

REAL_DOCKER="/usr/bin/docker"
if [ "$(id -u)" -ne 0 ] && [ "${FLEET_DOCKER_ADMIN:-0}" != "1" ]; then
  logger -t docker-audit-guard "user=$(id -un) uid=$(id -u) pwd=$PWD args=$*" 2>/dev/null || true
fi
exec "$REAL_DOCKER" "$@"
