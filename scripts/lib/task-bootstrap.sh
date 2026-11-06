#!/usr/bin/env bash

# Immutable bootstrap for the repository-local Go Task runner. This file is
# sourced by start.sh and intentionally has no top-level side effects.

readonly INSTALL_DOCTOR_TASK_VERSION='v3.54.0'
readonly INSTALL_DOCTOR_TASK_VERSION_NUMBER='3.54.0'
readonly INSTALL_DOCTOR_TASK_RELEASE_ORIGIN='https://github.com/go-task/task/releases/download'
readonly INSTALL_DOCTOR_TASK_MAX_ARCHIVE_BYTES='25000000'
readonly INSTALL_DOCTOR_TASK_MAX_MEMBERS='32'

# Digests are copied from the immutable upstream v3.54.0 checksum asset:
# https://github.com/go-task/task/releases/download/v3.54.0/task_checksums.txt

task_bootstrap_platform() {
  case "$1" in
    macos) printf '%s\n' darwin ;;
    ubuntu|debian|fedora|alpine|arch|linux|wsl|container) printf '%s\n' linux ;;
    *) printf 'Unsupported Task bootstrap operating system: %s\n' "$1" >&2; return 64 ;;
  esac
}

task_bootstrap_arch() {
  case "$1" in
    x86_64|amd64) printf '%s\n' amd64 ;;
    aarch64|arm64) printf '%s\n' arm64 ;;
    i386|i486|i586|i686) printf '%s\n' 386 ;;
    armv7l|armv7|armv6l|armv6|armhf|arm) printf '%s\n' arm ;;
    *) printf 'Unsupported Task bootstrap architecture: %s\n' "$1" >&2; return 64 ;;
  esac
}

task_bootstrap_sha256() {
  case "$1" in
    task_darwin_amd64.tar.gz) printf '%s\n' '0543b0844a725814c0412d3f4bed12873ce9ed0da207b15775f63a97d734aac0' ;;
    task_darwin_arm64.tar.gz) printf '%s\n' '12a69fcf37bb8d5bc9150c44f9a936775b73e59ff044c2c245232f198c135637' ;;
    task_linux_386.tar.gz) printf '%s\n' 'e67808944b3710e3d0fce6dd18d3c263ad95887db70181038862bc25dcd86d1d' ;;
    task_linux_amd64.tar.gz) printf '%s\n' '680859dbb4d881a9c72d4d9a8f510825450849af8567deacd7302c01124416fb' ;;
    task_linux_arm.tar.gz) printf '%s\n' 'f9766cf6f38ce3d474b981f404d37c2ab6054e66122957d854a9f5316fbcd208' ;;
    task_linux_arm64.tar.gz) printf '%s\n' 'd7189d439d4a6058e39e1b2acd7c8b27acd4856691b408f23b242e4294e1df5b' ;;
    *) printf 'No pinned checksum for Task asset: %s\n' "$1" >&2; return 64 ;;
  esac
}

# SHA-256 of the exact uncompressed `task` member in each pinned archive. This
# lets an unchanged run authenticate its installed binary without networking.
task_bootstrap_binary_sha256() {
  case "$1" in
    task_darwin_amd64.tar.gz) printf '%s\n' '15a679d0d9983f5c99395f4da04b9f7e4e354902f184a74203fdb562ec3bfd0a' ;;
    task_darwin_arm64.tar.gz) printf '%s\n' '47301f293af8e049a6906982c8dd88fedbf55d40357e2fbe99f9fc97ba491846' ;;
    task_linux_386.tar.gz) printf '%s\n' 'c46ca52863667290d001946bee7b8109bc673b385eaa194d53524f644ef5792a' ;;
    task_linux_amd64.tar.gz) printf '%s\n' 'f00f13e91018d0aa8d4b5dc59ec5b523d0f8941760e33276ea31af7eb86fd61f' ;;
    task_linux_arm.tar.gz) printf '%s\n' 'fe52d6c9c3cab5767750e78893ce30169f3933314f597099fd727c785e94194a' ;;
    task_linux_arm64.tar.gz) printf '%s\n' 'e7aa12d271f9829354138ac243dd89b7bacdcad5ecdb40d7924502eba7e80aed' ;;
    *) printf 'No pinned binary checksum for Task asset: %s\n' "$1" >&2; return 64 ;;
  esac
}

task_bootstrap_hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    printf 'A SHA-256 implementation (sha256sum or shasum) is required.\n' >&2
    return 69
  fi
}

task_bootstrap_verify_digest() {
  local actual
  actual="$(task_bootstrap_hash_file "$1")" || return
  if [ "$actual" != "$2" ]; then
    printf 'Task archive checksum mismatch: expected %s, received %s\n' "$2" "$actual" >&2
    return 65
  fi
}

task_bootstrap_is_expected_binary() {
  local actual
  [ -x "$1" ] || return 1
  actual="$(task_bootstrap_hash_file "$1")" || return
  [ "$actual" = "$2" ] || return 1
  [ "$("$1" --version 2>/dev/null)" = "$INSTALL_DOCTOR_TASK_VERSION_NUMBER" ]
}

task_bootstrap_member_is_safe() {
  local member="$1" component remainder
  [ -n "$member" ] || return 1
  if printf '%s' "$member" | LC_ALL=C grep -q '[[:cntrl:]]'; then return 1; fi
  case "$member" in
    /*|*\\*|*//*|./*|*/./*|*/.|..|../*|*/../*|*/..) return 1 ;;
  esac
  remainder="$member"
  while [ -n "$remainder" ]; do
    component="${remainder%%/*}"
    [ -n "$component" ] && [ "$component" != '.' ] && [ "$component" != '..' ] || return 1
    if [ "$remainder" = "$component" ]; then break; fi
    remainder="${remainder#*/}"
  done
}

# Validate the full archive before extracting any bytes. Member names and type
# lines are read separately so paths containing spaces remain intact. Newlines
# and other control characters are rejected by the line-count/type checks.
task_bootstrap_preflight_archive() {
  local archive="$1" workspace="$2"
  local members="$workspace/members" types="$workspace/types"
  local member type count task_count parent probe

  LC_ALL=C tar -tzf "$archive" > "$members" || return 65
  LC_ALL=C tar -tvzf "$archive" | sed 's/^\(.\).*$/\1/' > "$types" || return 65
  count="$(wc -l < "$members" | tr -d ' ')"
  [ "$count" -gt 0 ] && [ "$count" -le "$INSTALL_DOCTOR_TASK_MAX_MEMBERS" ] || {
    printf 'Task archive has an invalid member count: %s\n' "$count" >&2
    return 65
  }
  [ "$(wc -l < "$types" | tr -d ' ')" = "$count" ] || {
    printf 'Task archive member/type inventory is inconsistent.\n' >&2
    return 65
  }
  [ -z "$(LC_ALL=C sort "$members" | uniq -d)" ] || {
    printf 'Task archive contains duplicate member paths.\n' >&2
    return 65
  }

  task_count=0
  exec 8< "$types"
  # The loop owns one descriptor; lookups open independent descriptors.
  # shellcheck disable=SC2094
  while IFS= read -r member; do
    IFS= read -r type <&8 || return 65
    task_bootstrap_member_is_safe "$member" || {
      printf 'Task archive contains an unsafe member path.\n' >&2
      return 65
    }
    case "$type" in
      -|d) ;;
      *) printf 'Task archive contains a link or special file.\n' >&2; return 65 ;;
    esac
    if [ "$member" = task ]; then
      [ "$type" = '-' ] || { printf 'Task archive member is not a regular file.\n' >&2; return 65; }
      task_count=$((task_count + 1))
    fi

    parent="${member%/*}"
    while [ "$parent" != "$member" ] && [ -n "$parent" ]; do
      if grep -Fqx "$parent" "$members"; then
        probe="$(awk -v wanted="$parent" 'NR==FNR { t[NR]=$0; next } $0==wanted { print t[FNR]; exit }' "$types" "$members")"
        [ "$probe" = d ] || {
          printf 'Task archive contains a file/directory type collision.\n' >&2
          return 65
        }
      fi
      member="$parent"
      parent="${member%/*}"
    done
  done < "$members"
  exec 8<&-
  [ "$task_count" -eq 1 ] || {
    printf 'Task archive must contain exactly one regular task binary.\n' >&2
    return 65
  }
}

task_bootstrap_download() {
  local url="$1" destination="$2"
  curl --fail --silent --show-error --location \
    --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 10 --max-time 120 --max-redirs 5 \
    --retry 2 --retry-delay 1 --max-filesize "$INSTALL_DOCTOR_TASK_MAX_ARCHIVE_BYTES" \
    --output "$destination" "$url"
  [ -f "$destination" ] && [ "$(wc -c < "$destination" | tr -d ' ')" -le "$INSTALL_DOCTOR_TASK_MAX_ARCHIVE_BYTES" ] || {
    printf 'Task archive exceeded the maximum permitted size.\n' >&2
    return 65
  }
}

install_pinned_task() (
  local detected_os="$1" machine="$2" target="$3"
  local platform arch asset expected expected_binary url workspace publish
  platform="$(task_bootstrap_platform "$detected_os")" || return
  arch="$(task_bootstrap_arch "$machine")" || return
  asset="task_${platform}_${arch}.tar.gz"
  expected="$(task_bootstrap_sha256 "$asset")" || return
  expected_binary="$(task_bootstrap_binary_sha256 "$asset")" || return
  url="$INSTALL_DOCTOR_TASK_RELEASE_ORIGIN/$INSTALL_DOCTOR_TASK_VERSION/$asset"

  umask 077
  workspace="$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-task.XXXXXXXX")" || return 73
  chmod 700 "$workspace"
  trap 'rm -rf -- "$workspace"; if [ -n "${publish:-}" ]; then rm -f -- "$publish"; fi' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  task_bootstrap_download "$url" "$workspace/$asset"
  task_bootstrap_verify_digest "$workspace/$asset" "$expected"
  task_bootstrap_preflight_archive "$workspace/$asset" "$workspace"
  LC_ALL=C tar -xOzf "$workspace/$asset" -- task > "$workspace/task"
  [ -s "$workspace/task" ] || { printf 'Extracted Task binary is empty.\n' >&2; return 65; }
  chmod 0755 "$workspace/task"
  task_bootstrap_is_expected_binary "$workspace/task" "$expected_binary" || {
    printf 'Extracted Task binary does not report the pinned version.\n' >&2
    return 65
  }

  mkdir -p "$(dirname "$target")"
  publish="$(mktemp "$(dirname "$target")/.task.XXXXXXXX")" || return 73
  cp "$workspace/task" "$publish"
  chmod 0755 "$publish"
  mv -f "$publish" "$target"
)
