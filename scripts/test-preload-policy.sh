#!/usr/bin/env bash
# Preload-policy guard (new-arc "install closer to the minimum, lazy everywhere" mandate, fire #200).
# `_preload: true` in software.yml = installx EAGER-installs the tool at provision time (vs the cnf hook
# lazy-installing it on first use). The prompt wants the eager set kept MINIMAL — only what must be
# pre-configured, a service, a desktop app, a script/bootstrap dependency, or the toolchain the cnf hook
# itself needs (Node/Go/Rust → npm/go/cargo lazy-installs). Every eager install is deploy-time cost, so a
# bloated preload set directly hurts the prompt's "speed of deployment" goal.
#
# This guard does NOT guess the user's "favorite software" (which convenience CLIs they want pre-installed
# is THEIR call). It enforces the objective invariants + a DOWN-ONLY RATCHET so the set can only shrink:
#   1. the toolchain (Node/Go/Rust — the cnf-hook substrate the prompt names) stays preloaded;
#   2. the bootstrap/script deps (gum/jq/yq/chezmoi/mise/zsh/git/curl — de-preloading any breaks provisioning) stay preloaded;
#   3. NO §6/§7-removed tool is preloaded (m-cli no-ops on macOS 15+; bash-it/Mackup/Nix/MacPorts dropped);
#   4. the total _preload count never GROWS past the ratchet (PRELOAD_CEILING, may only go DOWN as the favorite-trim lands).
# Pure file assertions, no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
YML="$ROOT/software.yml"
# Ratchet: the current preload count. LOWER it as the favorite-gated convenience trim lands; never raise it.
PRELOAD_CEILING="${PRELOAD_CEILING:-151}"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "preload policy — minimum eager install, lazy everywhere (fire #200)"

if [ ! -f "$YML" ]; then fail "software.yml missing ($YML)"; say "preload-policy: $P passed, $F failed"; exit 1; fi

# Emit one line per fact the shell asserts on: "COUNT <n>", "PRELOAD <name>" for every _preload:true entry.
FACTS="$(python3 - "$YML" <<'PY'
import yaml,sys
d=yaml.safe_load(open(sys.argv[1]))
sp=d.get('softwarePackages',d) if isinstance(d,dict) else d
pre=[k for k,v in (sp.items() if isinstance(sp,dict) else []) if isinstance(v,dict) and v.get('_preload') is True]
print("COUNT", len(pre))
for k in sorted(pre): print("PRELOAD", k)
PY
)"
[ -n "$FACTS" ] || { fail "could not parse software.yml preload set"; say "preload-policy: $P passed, $F failed"; exit 1; }

count="$(printf '%s\n' "$FACTS" | awk '$1=="COUNT"{print $2}')"
is_pre() { printf '%s\n' "$FACTS" | grep -qxE "PRELOAD $1"; }

# 1. toolchain the prompt explicitly names (the cnf-hook substrate: node→npm, go, rust→cargo lazy-installs).
for t in node go rust; do
  is_pre "$t" && pass "toolchain preloaded: $t (cnf-hook substrate — ready for on-demand installs)" || fail "toolchain NOT preloaded: $t (the cnf hook needs it ready)"
done

# 2. bootstrap/script deps — the provisioning scripts + the cnf index builder call these directly; if they
#    were lazy, bootstrap would break (the cnf hook returns 127 non-interactively, so it can't rescue a script).
for t in gum jq yq chezmoi mise zsh git curl; do
  is_pre "$t" && pass "bootstrap dep preloaded: $t" || fail "bootstrap dep NOT preloaded: $t (scripts depend on it at provision time)"
done

# 3. no §6/§7-removed tool is preloaded (dead eager installs). m-cli no-ops on macOS 15+ (§6); the others are dropped.
rmfail=""
for t in m-cli whalebrew macfuse mackup antigen gvisor bash-it nix macports; do
  is_pre "$t" && rmfail="$rmfail $t"
done
[ -z "$rmfail" ] && pass "no §6/§7-removed tool is preloaded" || fail "removed tool(s) still preloaded (dead eager install):$rmfail"

# 4. down-only ratchet — the eager set may only SHRINK toward the minimum.
if [ -n "$count" ] && [ "$count" -le "$PRELOAD_CEILING" ]; then
  pass "preload count $count <= ratchet $PRELOAD_CEILING (eager set is bounded + shrinking toward minimum)"
else
  fail "preload count $count > ratchet $PRELOAD_CEILING — eager set GREW (lower the ratchet only, never raise it)"
fi

# Informational: the convenience-CLI trim toward minimum is FAVORITE-gated (the user's call, not an autonomous guess).
say "note: $count tools preload eagerly; trimming the pure-convenience CLIs toward minimum needs the owner's favorite-list (a design call) — this guard enforces the direction (ratchet) + the invariants, not the favorite picks."

say "preload-policy: $P passed, $F failed"
[ "$F" -eq 0 ]
