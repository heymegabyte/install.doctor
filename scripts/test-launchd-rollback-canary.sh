#!/usr/bin/env bash
# Opt-in disposable-host proof for launchd load-state rollback semantics.
set -euo pipefail
umask 077

case "${INSTALL_DOCTOR_LAUNCHD_CANARY:-0}" in
  0) printf '%s\n' 'SKIP: launchd canary requires INSTALL_DOCTOR_LAUNCHD_CANARY=1'; exit 0 ;;
  1) ;;
  *) printf '%s\n' 'launchd canary opt-in must be exactly 0 or 1' >&2; exit 64 ;;
esac

[ "$(/usr/bin/uname -s)" = Darwin ] || { printf '%s\n' 'launchd canary requires Darwin' >&2; exit 1; }
[ "$(/usr/bin/id -u)" -ne 0 ] || { printf '%s\n' 'launchd canary refuses root' >&2; exit 1; }
for tool in /bin/launchctl /usr/bin/plutil /usr/bin/uuidgen /usr/bin/shasum /usr/bin/dscl /usr/bin/awk /bin/mktemp /bin/rm; do
  [ -x "$tool" ] || { printf 'missing trusted canary tool: %s\n' "$tool" >&2; exit 1; }
done

domain="gui/$(/usr/bin/id -u)"
suffix="$(/usr/bin/uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]' | /usr/bin/tr -d '-')"
label="space.megabyte.install-doctor.canary.${suffix}"
work="$('/bin/mktemp' -d "${TMPDIR:-/tmp}/install-doctor-launchd.XXXXXXXX")"
account="$(/usr/bin/id -un)"
authoritative_home="$(/usr/bin/dscl . -read "/Users/$account" NFSHomeDirectory | /usr/bin/awk 'NF >= 2 { print $2 }')"
[ -n "$authoritative_home" ] && [ "$authoritative_home" = "${HOME:-}" ] || { printf '%s\n' 'launchd canary cannot prove the authoritative user home' >&2; exit 1; }
agent_dir="$authoritative_home/Library/LaunchAgents"
agent_dir_created=0
plist="$agent_dir/$label.plist"
stdout_path="$work/stdout"
stderr_path="$work/stderr"
before_disabled="$work/before-disabled"
after_disabled="$work/after-disabled"
evidence_dir="${INSTALL_DOCTOR_LAUNCHD_CANARY_EVIDENCE_DIR:-$work/evidence}"
loaded=0

cleanup() {
  status=$?
  trap - EXIT INT TERM HUP
  if [ "$loaded" -eq 1 ] || /bin/launchctl print "$domain/$label" >/dev/null 2>&1; then
    /bin/launchctl bootout "$domain/$label" >/dev/null 2>&1 || status=1
  fi
  if /bin/launchctl print "$domain/$label" >/dev/null 2>&1; then status=1; fi
  /bin/rm -f -- "$plist"
  if [ "$agent_dir_created" -eq 1 ]; then /bin/rmdir "$agent_dir" >/dev/null 2>&1 || status=1; fi
  /bin/rm -rf -- "$work"
  exit "$status"
}
trap cleanup EXIT INT TERM HUP

if [ ! -d "$agent_dir" ]; then /bin/mkdir -m 700 -- "$agent_dir"; agent_dir_created=1; fi

/bin/launchctl print "$domain" >/dev/null
if [ -e "$plist" ] || /bin/launchctl print "$domain/$label" >/dev/null 2>&1; then
  printf 'refusing pre-existing launchd label: %s\n' "$label" >&2
  exit 1
fi
/bin/launchctl print-disabled "$domain" >"$before_disabled"

token="install-doctor-launchd-canary-$suffix"
/bin/mkdir -p -- "$evidence_dir"
/bin/chmod 700 "$evidence_dir"
/bin/cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>/bin/echo</string><string>$token</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>StandardOutPath</key><string>$stdout_path</string>
  <key>StandardErrorPath</key><string>$stderr_path</string>
</dict></plist>
PLIST
/bin/chmod 600 "$plist"
/usr/bin/plutil -lint -- "$plist" >/dev/null
[ "$(/usr/bin/plutil -extract Label raw -o - -- "$plist")" = "$label" ]

/bin/launchctl bootstrap "$domain" "$plist"
loaded=1
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  [ -s "$stdout_path" ] && break
  /bin/sleep 0.2
done
[ "$(/usr/bin/sed -n '1p' "$stdout_path")" = "$token" ]
[ ! -s "$stderr_path" ]
/bin/launchctl print "$domain/$label" >"$evidence_dir/loaded-state.txt"
/usr/bin/shasum -a 256 "$plist" >"$evidence_dir/plist.sha256"

node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/launchd-rollback-canary.mjs" "$label" "$plist" "$(/usr/bin/id -u)" >"$evidence_dir/adapter-result.json"
loaded=0
/bin/launchctl print-disabled "$domain" >"$after_disabled"
/usr/bin/cmp -s "$before_disabled" "$after_disabled" || {
  printf '%s\n' 'launchd disabled overrides changed during the canary' >&2
  exit 1
}
printf 'label=%s\ndomain=%s\nresult=verified\n' "$label" "$domain" >"$evidence_dir/result.txt"
printf 'launchd canary verified: %s\n' "$label"
