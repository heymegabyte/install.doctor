#!/usr/bin/env bash
# mise keep-current gate (fire #365 — dot_config modernization arc idea #2, from the #362 audit).
# home/dot_config/mise/config.toml pins the GLOBAL default runtimes mise installs on every machine. The audit
# found EOL pins: java openjdk-20 (non-LTS, superseded), ruby 3.1.3 (EOL 2025-03), python missing the current
# 3.13 while keeping EOL 3.10. This gate locks a "no EOL-pinned runtime" invariant: java is an LTS (>=21),
# ruby >=3.3, python includes a current (3.13) and drops EOL 3.10 — a keep-current floor (bumping it over time
# IS the keep-current action the prompt wants). Also asserts the config is present + has a [tools] section.
# Pure file assertions (config.toml is NOT a chezmoi template — literal); the actual install is host-gated
# (mise resolves these version specs on `mise install`). No network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="${MISE_CONFIG:-$ROOT/home/dot_config/mise/config.toml}"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-mise.sh"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "mise keep-current (config.toml global runtime pins)"

if [ ! -f "$CFG" ]; then
  fail "mise config.toml MISSING ($CFG)"
  say "mise-config: $P passed, $F failed"
  exit 1
fi
pass "mise config.toml present"
grep -qE '^\[tools\]' "$CFG" && pass "[tools] section present" || fail "[tools] section missing"

# java — must be an LTS (>=21). EOL non-LTS 20 (and 19/18/etc) fail. (openjdk-21 .. openjdk-99)
grep -qE "^java = 'openjdk-(2[1-9]|[3-9][0-9])'" "$CFG" && pass "java pinned to an LTS (>=21 — off EOL non-LTS 20)" || fail "java pin is EOL/non-LTS (<21) — bump to an LTS, e.g. openjdk-21"

# ruby — must be >=3.3 (3.1 EOL 2025-03, 3.2 EOL ~2026). Matches 3.3..3.99 or 4+.
grep -qE "^ruby = '(3\.([3-9]|[1-9][0-9])|[4-9])" "$CFG" && pass "ruby >=3.3 (off EOL 3.1/3.2)" || fail "ruby pin is EOL (<3.3) — bump it (3.1 EOL'd 2025-03)"

# python — must include a current version (3.13) and must NOT keep EOL 3.10.
pyline="$(grep -E '^python = ' "$CFG" 2> /dev/null)"
printf '%s' "$pyline" | grep -qE "'3\.13'" && pass "python includes the current 3.13" || fail "python missing 3.13 (the current stable)"
if printf '%s' "$pyline" | grep -qE "'3\.10'"; then fail "python still pins EOL 3.10 (EOL 2026-10) — drop it"; else pass "python drops EOL 3.10"; fi

# idiomatic version files (#366): mise 2026 REMOVED the old boolean legacy_version_file → the per-tool
# idiomatic_version_file_enable_tools list. A stale legacy_version_file is now a DEAD no-op, so .nvmrc /
# .python-version / .ruby-version are silently unread. Lock the modern setting + forbid the removed one.
grep -qE '^idiomatic_version_file_enable_tools = ' "$CFG" && pass "idiomatic_version_file_enable_tools set (current mise setting for .nvmrc/.python-version/… — replaces the removed legacy_version_file)" || fail "missing idiomatic_version_file_enable_tools (mise 2026 removed legacy_version_file; idiomatic version files silently unread)"
if grep -qE '^legacy_version_file' "$CFG"; then fail "stale legacy_version_file present — REMOVED in mise 2026 (dead no-op); switch to idiomatic_version_file_enable_tools"; else pass "no dead legacy_version_file setting (removed in mise 2026)"; fi

if grep -qE '(^|[^[:alnum:]_-])sudo([^[:alnum:]_-]|$)|/Library/Java/JavaVirtualMachines|openjdk-20' "$HOOK"; then
  fail "mise user hook still carries obsolete privileged Java mutation authority"
else
  pass "mise hook is user-scoped and preserves existing system Java state"
fi

say "mise-config: $P passed, $F failed"
[ "$F" -eq 0 ]
