#!/usr/bin/env bash
# scripts/test-auto-update-disable.sh — Durable auto-update-disable guard (removal wave two, XS-23).
#
# The tracked `home/dot_config/system/Library/LaunchDaemons/com.apple.automatedupdates.plist` deployed a
# LaunchDaemon that runs `softwareupdate -i -a` every hour, while disableAutoUpdateDarwin tried to
# `launchctl unload` it. The two fought: chezmoi re-deployed the daemon on every apply, and a bare
# `unload` is undone on the next boot when launchd re-scans /Library/LaunchDaemons. Net effect: a host
# configured to "never auto-update" (background replacement of running apps is the top corruption
# source) silently resumed overnight auto-installs. The fix deletes the source plist (fresh hosts never
# deploy the daemon) and makes disableAutoUpdateDarwin remove the deployed file too (existing hosts stop
# loading it durably).
#
# This guard asserts: (1) the source plist is gone, (2) the function still unloads the label, (3) the
# function now ALSO removes the deployed file — the durability half that a `unload`-only regression would
# silently drop, (4) the independent SoftwareUpdate / App Store defaults writes are preserved (removing
# the daemon must not remove the four softwareupdated flags), and (5) the sibling juicefs plist is
# untouched (we removed one daemon, not the whole LaunchDaemons tree). The detector is re-run against a
# planted fixture to prove it is non-vacuous. Pure file assertions, no network, no sudo.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

POST="$ROOT/home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl"
PLIST_SRC="$ROOT/home/dot_config/system/Library/LaunchDaemons/com.apple.automatedupdates.plist"
JUICE="$ROOT/home/dot_config/system/Library/LaunchDaemons/com.juicefs.home.mount.plist"

# The detector under test: the durable-disable invariant must hold for (plist source dir, post script).
detect() {
  local src_dir="$1" post="$2"
  [ ! -f "$src_dir/com.apple.automatedupdates.plist" ] || return 1
  grep -qF 'rm -f /Library/LaunchDaemons/com.apple.automatedupdates.plist' "$post" || return 1
  grep -qF 'launchctl unload /Library/LaunchDaemons/com.apple.automatedupdates.plist' "$post" || return 1
  return 0
}

say "durable auto-update-disable guard (automatedupdates LaunchDaemon)"

# 1. The self-defeating source plist must not ship — fresh hosts must never deploy the daemon.
if [ ! -f "$PLIST_SRC" ]; then
  pass "auto-update LaunchDaemon source removed (home/dot_config/system/Library/LaunchDaemons/com.apple.automatedupdates.plist)"
else
  fail "auto-update LaunchDaemon source still ships — fresh hosts re-deploy the daemon disableAutoUpdateDarwin tries to kill"
fi

# 2. The unload half is preserved — we must still unload a loaded daemon on existing hosts.
grep -qF 'launchctl unload /Library/LaunchDaemons/com.apple.automatedupdates.plist' "$POST" \
  && pass "disableAutoUpdateDarwin still unloads the label" \
  || fail "disableAutoUpdateDarwin no longer unloads the label — the unload half was dropped"

# 3. The durability half — the deployed file must now be REMOVED, not merely unloaded (a bare unload is
#    undone on next boot when launchd re-scans /Library/LaunchDaemons).
grep -qF 'rm -f /Library/LaunchDaemons/com.apple.automatedupdates.plist' "$POST" \
  && pass "disableAutoUpdateDarwin removes the deployed plist (durable — survives reboot)" \
  || fail "the deployed plist is only unloaded, not removed — auto-updates silently resume on next boot"

# 4. The independent softwareupdated flags survive — removing the daemon must not remove the four
#    system-domain SoftwareUpdate defaults writes or the App Store auto-update write.
flags_ok=1
for kw in AutomaticDownload AutomaticallyInstallMacOSUpdates ConfigDataInstall CriticalUpdateInstall 'com.apple.commerce AutoUpdate'; do
  grep -qF "$kw" "$POST" || flags_ok=0
done
if [ "$flags_ok" -eq 1 ]; then
  pass "SoftwareUpdate + App Store defaults writes preserved (independent disable path intact)"
else
  fail "a SoftwareUpdate/App Store defaults write was dropped alongside the daemon removal"
fi

# 5. Sanity: only the auto-update daemon was removed — the sibling juicefs LaunchDaemon must remain.
if [ -f "$JUICE" ]; then
  pass "sibling LaunchDaemon preserved (com.juicefs.home.mount.plist — one daemon removed, not the whole tree)"
else
  fail "the sibling juicefs LaunchDaemon is missing — an over-broad deletion took the whole LaunchDaemons tree"
fi

# 6. Non-vacuous self-test: plant the source plist and strip the durable rm, then re-run the SAME
#    detector. Both mutations must independently fail it, proving the clean-tree passes were real.
tmp="$(mktemp -d)"
mkdir -p "$tmp/LaunchDaemons"
# (a) source plist planted -> detector must fail on the source-absence check.
printf '<plist version="1.0"><dict><key>Label</key><string>com.apple.automatedupdates</string></dict></plist>\n' \
  > "$tmp/LaunchDaemons/com.apple.automatedupdates.plist"
if detect "$tmp/LaunchDaemons" "$POST"; then
  fail "detector returned clean with a planted auto-update plist — the source-absence check is vacuous"
else
  pass "detector flags a planted auto-update plist (source-absence check non-vacuous)"
fi
# (b) rm line stripped -> detector must fail on the durability check.
sed '/rm -f \/Library\/LaunchDaemons\/com.apple.automatedupdates.plist/d' "$POST" > "$tmp/post-no-rm.tmpl"
if detect "$ROOT/home/dot_config/system/Library/LaunchDaemons" "$tmp/post-no-rm.tmpl"; then
  fail "detector returned clean with the durable rm stripped — the durability check is vacuous"
else
  pass "detector flags a missing durable rm (durability check non-vacuous)"
fi
rm -rf "$tmp"

say "auto-update-disable: $P passed, $F failed"
[ "$F" -eq 0 ]
