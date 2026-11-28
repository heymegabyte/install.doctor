#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
for dependency in restic jq timeout; do
  command -v "$dependency" >/dev/null || {
    printf 'Required test dependency missing: %s\n' "$dependency" >&2
    exit 1
  }
done

fixture=$(mktemp -d)
trap 'find "$fixture" -depth -delete' EXIT
hook=home/dot_local/bin/post-installx/executable_post-backrest.sh

# Render the checked-in heredoc with Bash, as the native hook does.
awk '
  /tee \/usr\/local\/sbin\/restic-host-backup .*<<EOF$/ {
    print "HOST_SHORT=fixture"
    print "cat <<EOF"
    render=1
    next
  }
  render {print}
  render && $0=="EOF" {ready=1; exit}
  END {if (!ready) exit 1}
' "$hook" > "$fixture/render.sh"
bash "$fixture/render.sh" |
  sed -e "s|/etc/|$fixture/etc/|g" -e "s|/home/|$fixture/home/|g" \
    -e "s|/var/cache/megabyte/backrest|$fixture/cache|g" > "$fixture/writer.sh"
bash -n "$fixture/writer.sh"

mkdir -p "$fixture/etc/backrest" "$fixture/etc/ufw"
printf 'synthetic config\n' > "$fixture/etc/ufw/after.rules"
touch "$fixture/etc/backrest/excludes.txt"
export RESTIC_REPOSITORY="$fixture/repo" RESTIC_PASSWORD=synthetic-fixture-password
unset RESTIC_EXPECTED_REPOSITORY_ID
printf 'RESTIC_REPOSITORY_HOST=%s\nRESTIC_PASSWORD=%s\n' \
  "$RESTIC_REPOSITORY" "$RESTIC_PASSWORD" > "$fixture/etc/fixture-backup.env"

if bash "$fixture/writer.sh" > "$fixture/out" 2>&1; then
  printf 'Writer accepted a missing repository.\n' >&2
  exit 1
fi
grep -Fq 'configured Restic repository is unreadable' "$fixture/out"
test ! -e "$RESTIC_REPOSITORY/config"

restic init >/dev/null
repository_id=$(restic cat config | jq -er '.id')
restic backup --time '2020-01-01 00:00:00' "$fixture/etc/ufw" "$fixture/etc/backrest/excludes.txt" >/dev/null
restic backup --time '2020-01-01 01:00:00' "$fixture/etc/ufw" "$fixture/etc/backrest/excludes.txt" >/dev/null
before=$(restic snapshots --json | jq -cer 'map(.id) | sort | select(length==2)')

if RESTIC_EXPECTED_REPOSITORY_ID=$(printf '%064d' 0) bash "$fixture/writer.sh" > "$fixture/out" 2>&1; then
  printf 'Writer accepted a mismatched repository identity.\n' >&2
  exit 1
fi
grep -Fq 'configured Restic repository identity could not be verified' "$fixture/out"
test "$before" = "$(restic snapshots --json | jq -cer 'map(.id) | sort')"

RESTIC_EXPECTED_REPOSITORY_ID="$repository_id" bash "$fixture/writer.sh" > "$fixture/out"
restic snapshots --json |
  jq -e --argjson before "$before" 'map(.id) | length==3 and ($before - . | length==0)' >/dev/null
printf 'restic-writer-safety: PASS\n'
