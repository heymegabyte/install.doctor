#!/usr/bin/env bash
# @file post-installx/executable_post-gitlab-runner.sh
# @description Opt-in, idempotent GitLab Runner enrollment
#   (upstream feature request: heymegabyte/install.doctor#134).
#
#   The GitHub runner capability mints its registration token at enroll time instead of
#   asking the operator to paste one in. This hook gives `gitlab-runner` the same
#   behaviour: it asks the GitLab API for a fresh runner authentication token
#   (`POST {url}/api/v4/user/runners`) using an access token that carries the
#   `create_runner` grant, then registers it with `gitlab-runner register --non-interactive`.
#   No pre-minted registration token is required anywhere in the environment.
#
#   Enabled by file convention: `runPostInstallxHooks` in
#   home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl dispatches the hook
#   after an explicit first-use install of the `gitlab-runner` catalog package. It never
#   runs unprompted, because the hook requires an explicit opt-in below.
#
#   Contract (post-installx/_TEMPLATE.sh):
#     1. set -euo pipefail
#     2. OS gate + binary gate + explicit opt-in gate
#     3. structured logging on stderr, never the secret
#     4. idempotent: an already-registered runner name is left untouched
#     5. mktemp trap cleanup
#
#   Security posture (why the retired GitHub-runner hook is a fail-closed boundary):
#     - no secret is ever interpolated into `bash -c` or any shell string;
#     - the access token reaches curl through a 0600 header file (`--header @file`),
#       so it never appears in argv or the process list;
#     - the minted runner token never reaches stdout/stderr;
#     - the runner config is written under `umask 077` and re-chmodded 0600;
#     - nothing privileged (`sudo`, service management) is executed, and no
#       caller-supplied path is ever deleted.
#
#   Inputs (env, `get-secret`, or age-encrypted chezmoi secret):
#     GITLAB_ACCESS_TOKEN      required — access token with `create_runner` (and
#                              `api` for group/project scope) on the target instance.
#   Optional:
#     GITLAB_URL               default https://gitlab.com/
#     GITLAB_RUNNER_SCOPE      instance | group | project (default: group)
#     GITLAB_RUNNER_GROUP_ID   required when scope=group
#     GITLAB_RUNNER_PROJECT_ID required when scope=project
#     GITLAB_RUNNER_NAME       default "<hostname>-gitlab-runner"
#     GITLAB_RUNNER_EXECUTOR   docker | shell | virtualbox (default: docker)
#     GITLAB_RUNNER_IMAGE      default alpine:latest (docker executor)
#     GITLAB_RUNNER_BASE_VM    required when executor=virtualbox
#     GITLAB_RUNNER_TAGS       comma-separated tag list
#     GITLAB_RUNNER_CONFIG     default $XDG_CONFIG_HOME/gitlab-runner/config.toml
#
#   Enable with `INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1`.
set -euo pipefail

umask 077

log() { printf 'gitlab-runner: %s\n' "$*" >&2; }

# --- 2. OS gate -------------------------------------------------------------
case "$(uname -s 2>/dev/null)" in
  Linux | Darwin) ;;
  *)
    log 'GitLab Runner enrollment is inapplicable on this platform'
    exit 0
    ;;
esac

# --- 2. binary gate ---------------------------------------------------------
if ! command -v gitlab-runner >/dev/null 2>&1; then
  log 'gitlab-runner is not installed; skipping enrollment'
  exit 0
fi

# --- 2. opt-in gate ---------------------------------------------------------
if [ "${INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL:-0}" != 1 ]; then
  log 'lazy enrollment; set INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1 to enable it'
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  log 'curl is required to mint a GitLab runner authentication token'
  exit 25
fi

# --- secret resolution: env -> get-secret -> age-encrypted chezmoi secret ----
resolve_secret() {
  local name="$1"
  local value="${!1:-}"
  local secret_file="${XDG_DATA_HOME:-$HOME/.local/share}/chezmoi/home/.chezmoitemplates/secrets/$name"

  if [ -z "$value" ] && command -v get-secret >/dev/null 2>&1; then
    value="$(get-secret "$name" 2>/dev/null || true)"
  fi
  if [ -z "$value" ] && command -v chezmoi >/dev/null 2>&1 && [ -f "$secret_file" ]; then
    value="$(chezmoi decrypt "$secret_file" 2>/dev/null || true)"
  fi
  printf '%s' "$value"
}

ACCESS_TOKEN="$(resolve_secret GITLAB_ACCESS_TOKEN)"
if [ -z "$ACCESS_TOKEN" ]; then
  log 'no GITLAB_ACCESS_TOKEN resolved (env, get-secret, or chezmoi secret); refusing to enroll'
  exit 20
fi

GITLAB_URL="${GITLAB_URL:-https://gitlab.com/}"
GITLAB_URL="${GITLAB_URL%/}"

SCOPE="$(printf '%s' "${GITLAB_RUNNER_SCOPE:-group}" | tr '[:upper:]' '[:lower:]')"
case "$SCOPE" in
  instance | group | project) ;;
  *)
    log "GITLAB_RUNNER_SCOPE must be instance, group, or project (got '$SCOPE')"
    exit 2
    ;;
esac

case "$SCOPE" in
  group)
    if [ -z "${GITLAB_RUNNER_GROUP_ID:-}" ]; then
      log 'GITLAB_RUNNER_GROUP_ID is required for group-scoped runners'
      exit 2
    fi
    case "$GITLAB_RUNNER_GROUP_ID" in
      '' | *[!0-9]*)
        log 'GITLAB_RUNNER_GROUP_ID must be a positive integer'
        exit 2
        ;;
    esac
    ;;
  project)
    if [ -z "${GITLAB_RUNNER_PROJECT_ID:-}" ]; then
      log 'GITLAB_RUNNER_PROJECT_ID is required for project-scoped runners'
      exit 2
    fi
    case "$GITLAB_RUNNER_PROJECT_ID" in
      '' | *[!0-9]*)
        log 'GITLAB_RUNNER_PROJECT_ID must be a positive integer'
        exit 2
        ;;
    esac
    ;;
esac

EXECUTOR="${GITLAB_RUNNER_EXECUTOR:-docker}"
case "$EXECUTOR" in
  docker | shell | virtualbox | kubernetes) ;;
  *)
    log "GITLAB_RUNNER_EXECUTOR '$EXECUTOR' is not supported by this hook"
    exit 2
    ;;
esac
if [ "$EXECUTOR" = virtualbox ] && [ -z "${GITLAB_RUNNER_BASE_VM:-}" ]; then
  log 'GITLAB_RUNNER_BASE_VM is required for the virtualbox executor'
  exit 2
fi

CONFIG="${GITLAB_RUNNER_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/gitlab-runner/config.toml}"
RUNNER_NAME="${GITLAB_RUNNER_NAME:-$(hostname 2>/dev/null || printf 'runner')-gitlab-runner}"
RUNNER_IMAGE="${GITLAB_RUNNER_IMAGE:-alpine:latest}"
RUNNER_TAGS="${GITLAB_RUNNER_TAGS:-}"

# --- 4. idempotency: never re-register a name that already exists -----------
if [ -f "$CONFIG" ] && grep -Fq "name = \"$RUNNER_NAME\"" "$CONFIG"; then
  log "runner '$RUNNER_NAME' is already registered in $CONFIG; nothing to do"
  exit 0
fi

# --- 5. temp workspace + cleanup -------------------------------------------
TMP_DIR="$(mktemp -d)"
RUNNER_TOKEN=''
# Invoked indirectly through the `trap` below; ShellCheck cannot see the call site.
# shellcheck disable=SC2329
cleanup() {
  RUNNER_TOKEN=''
  ACCESS_TOKEN=''
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT HUP INT TERM

HEADER_FILE="$TMP_DIR/curl-headers"
RESPONSE_FILE="$TMP_DIR/runners.json"
REGISTER_LOG="$TMP_DIR/register.log"
printf 'PRIVATE-TOKEN: %s\n' "$ACCESS_TOKEN" >"$HEADER_FILE"
chmod 0600 "$HEADER_FILE"

# --- mint a runner authentication token via the GitLab API ------------------
API_URL="$GITLAB_URL/api/v4/user/runners"
CURL_ARGS=(
  --silent
  --show-error
  --fail-with-body
  --max-time 30
  --request POST
  --header "@$HEADER_FILE"
  --data-urlencode "runner_type=${SCOPE}_type"
  --data-urlencode "description=$RUNNER_NAME"
  --output "$RESPONSE_FILE"
)
if [ -n "$RUNNER_TAGS" ]; then
  CURL_ARGS+=(--data-urlencode "tag_list=$RUNNER_TAGS")
fi
case "$SCOPE" in
  group) CURL_ARGS+=(--data-urlencode "group_id=$GITLAB_RUNNER_GROUP_ID") ;;
  project) CURL_ARGS+=(--data-urlencode "project_id=$GITLAB_RUNNER_PROJECT_ID") ;;
esac

if ! curl "${CURL_ARGS[@]}" "$API_URL"; then
  log "GitLab rejected the runner-token request at $API_URL (check create_runner on GITLAB_ACCESS_TOKEN)"
  exit 21
fi

if command -v jq >/dev/null 2>&1; then
  RUNNER_TOKEN="$(jq -r '.token // empty' "$RESPONSE_FILE" 2>/dev/null || true)"
else
  # Fallback for hosts without jq: the runner token is a flat JSON string field.
  RUNNER_TOKEN="$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RESPONSE_FILE" | head -n 1)"
fi
if [ -z "$RUNNER_TOKEN" ]; then
  log "GitLab returned no runner authentication token for '$RUNNER_NAME' ($SCOPE scope)"
  exit 22
fi

# --- register the minted token ---------------------------------------------
CONFIG_DIR="$(dirname -- "$CONFIG")"
mkdir -p -- "$CONFIG_DIR"
chmod 0700 "$CONFIG_DIR"

REGISTER_ARGS=(
  register
  --non-interactive
  --url "$GITLAB_URL"
  --token "$RUNNER_TOKEN"
  --name "$RUNNER_NAME"
  --executor "$EXECUTOR"
  --config "$CONFIG"
)
if [ -n "$RUNNER_TAGS" ]; then
  REGISTER_ARGS+=(--tag-list "$RUNNER_TAGS")
fi
if [ "$EXECUTOR" = docker ]; then
  REGISTER_ARGS+=(--docker-image "$RUNNER_IMAGE")
fi
if [ "$EXECUTOR" = virtualbox ]; then
  REGISTER_ARGS+=(--virtualbox-base-name "$GITLAB_RUNNER_BASE_VM")
fi

# `--token` reaches the trusted gitlab-runner binary as a single argv element (never a
# shell string), and the process is short-lived; its output is captured so the token
# cannot leak into provisioning logs.
if ! gitlab-runner "${REGISTER_ARGS[@]}" >"$REGISTER_LOG" 2>&1; then
  log 'gitlab-runner register failed (output suppressed to keep the token out of logs)'
  exit 23
fi
chmod 0600 "$CONFIG"

if ! gitlab-runner verify --config "$CONFIG" >"$REGISTER_LOG" 2>&1; then
  log "runner '$RUNNER_NAME' was registered but verification failed; check network reachability of $GITLAB_URL"
  exit 24
fi

log "registered runner '$RUNNER_NAME' ($SCOPE scope, $EXECUTOR executor) into $CONFIG"
exit 0
