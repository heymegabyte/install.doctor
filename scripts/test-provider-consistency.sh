#!/usr/bin/env bash
# D04/D13 gate (#165) — the installable PROVIDER SET must be IDENTICAL across the 4 places it is defined, so
# the App Store (what the user SEES) and the cnf lazy-installer (what actually RUNS) can never disagree about
# which package managers exist. Add a manager to one and forget another → the App Store documents an install
# command the hook can't run, OR the hook installs via a manager the catalog never surfaces (a D04 violation:
# "share provider-selection rules across provisioning + lazy install"). The maps live in different languages
# (shell + TS) so they can't literally share code — this guard enforces that they stay in lockstep. Sources:
#   1. the index BUILDER's JQ column list      (home/dot_local/bin/executable_cnf-build-index)
#   2. the cnf hook's column→manager MAP        (home/dot_config/shell/not-found-hook.sh)
#   3. the cnf hook's __cnf_do_install CASES     (same file — what actually installs)
#   4. the control-plane INSTALL_CMD keys        (packages/control-plane/src/index.ts — the App Store commands)
# Plus: UPDATE_CMD / UNINSTALL_CMD providers must be a SUBSET of INSTALL_CMD (you can't update/uninstall via a
# manager you can't install with). Pure file assertions, no network. Pattern-based (robust to line shifts).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_config/shell/not-found-hook.sh"
BUILDER="$ROOT/home/dot_local/bin/executable_cnf-build-index"
IDX="$ROOT/packages/control-plane/src/index.ts"
UPD="$ROOT/home/dot_local/bin/executable_update-system"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "provider-set consistency (D04/D13)"

for f in "$HOOK" "$BUILDER" "$IDX" "$UPD"; do
  [ -f "$f" ] || { fail "source file missing: $f"; say "provider-consistency: $P passed, $F failed"; exit 1; }
done

# 1. index builder — the JQ array `[$v.brew,$v.apt,…]` (the TSV columns the index is built from).
s_builder="$(grep -oE '\$v\.[a-z]+' "$BUILDER" | sed 's/\$v\.//' | sort -u | tr '\n' ' ')"
# 2. cnf hook column→manager map — `brew)col=3;;apt)col=4;;…`.
s_colmap="$(grep -oE '[a-z]+\)col=' "$HOOK" | sed 's/)col=//' | sort -u | tr '\n' ' ')"
# 3. cnf hook __cnf_do_install cases — the managers that actually install.
s_install_hook="$(sed -n '/^__cnf_do_install/,/\*) return 1/p' "$HOOK" | grep -oE '^    [a-z]+\)' | tr -d ' )' | sort -u | tr '\n' ' ')"
# 4. control-plane INSTALL_CMD keys — the per-provider install commands the App Store shows.
s_install_cp="$(sed -n '/^const INSTALL_CMD/,/^};/p' "$IDX" | grep -oE '^  [a-z]+:' | tr -d ' :' | sort -u | tr '\n' ' ')"

# sanity: a broken extraction (empty / near-empty) would make equal-but-wrong sets falsely pass → floor it.
nprov="$(printf '%s' "$s_builder" | wc -w | tr -d ' ')"
if [ "${nprov:-0}" -ge 10 ]; then pass "provider set resolved ($nprov managers from the index builder)"; else fail "builder provider set too small ($nprov < 10) — extraction broke: [$s_builder]"; fi

[ "$s_builder" = "$s_colmap" ]      && pass "index-builder columns == cnf hook column-map" || fail "builder [$s_builder] != cnf colmap [$s_colmap]"
[ "$s_colmap" = "$s_install_hook" ] && pass "cnf hook column-map == cnf hook __cnf_do_install cases" || fail "cnf colmap [$s_colmap] != cnf install cases [$s_install_hook]"
[ "$s_install_hook" = "$s_install_cp" ] && pass "cnf hook install cases == control-plane INSTALL_CMD (D04: lazy-install ↔ App Store agree)" || fail "cnf install [$s_install_hook] != control-plane INSTALL_CMD [$s_install_cp]"

# 4b (#276). The AI-fallback SAFETY allowlist (__cnf_ai_safe) must accept EVERY manager the cnf hook can install
#     through — else a valid AI-suggested `<mgr> install X` is REFUSED on that platform. This is the #274 bug
#     generalized into the contract: apk was a first-class install manager but was MISSING from the allowlist, so
#     `sudo apk add X` was rejected on Alpine. EXEMPT: cask, whose AI-install path is `brew install --cask …`
#     (leading token `brew`, already allowed — cask has no standalone binary). Invariant: install-manager − {cask} ⊆ ai_safe.
s_aisafe="$(grep -F 'brew|apt|apt-get' "$HOOK" | head -1 | sed -E 's/\).*//; s/^[[:space:]]*//' | tr '|' ' ' | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')"
naisafe="$(printf '%s' "$s_aisafe" | wc -w | tr -d ' ')"
if [ "${naisafe:-0}" -ge 10 ]; then
  aimiss=""
  for p in $s_install_hook; do
    [ "$p" = cask ] && continue   # cask → `brew install --cask`, leading token brew (already allowed)
    case " $s_aisafe " in *" $p "*) ;; *) aimiss="$aimiss $p";; esac
  done
  [ -z "$aimiss" ] && pass "every cnf install-manager (minus cask→brew) is in __cnf_ai_safe (AI fallback can't refuse a valid installer — #274 class locked)" || fail "__cnf_ai_safe MISSING installer(s):$aimiss — an AI-suggested install via these is REFUSED though the hook installs with them (the #274 apk-on-Alpine bug class)"
else
  fail "__cnf_ai_safe allowlist extraction broke (naisafe=$naisafe < 10) — [$s_aisafe]"
fi

# 5. UPDATE_CMD / UNINSTALL_CMD providers ⊆ INSTALL_CMD (can't update/uninstall via a manager you can't install with).
for map in UPDATE_CMD UNINSTALL_CMD; do
  sub="$(sed -n "/^const $map/,/^};/p" "$IDX" | grep -oE '^  [a-z]+:' | tr -d ' :' | sort -u)"
  extra=""
  for p in $sub; do case " $s_install_cp " in *" $p "*) ;; *) extra="$extra $p";; esac; done
  [ -z "$extra" ] && pass "$map providers ⊆ INSTALL_CMD (no orphan manager)" || fail "$map has providers not in INSTALL_CMD:$extra"
done

# 6 (#277). The Monday-02:00 cron (update-system) must KEEP CURRENT every manager the cnf hook INSTALLS through,
#     or that manager is on a documented no-safe-unattended-update-all EXCLUSION list — else a tool lazy-installed
#     via it silently ROTS (the #275 class: npm/pipx/gem were installed but never updated until #275 added their
#     updaters). Generalizes #275 into the contract. EXCLUDED (no safe unattended update-all): cargo (needs the
#     cargo-update crate), go (`go install` re-fetches per-binary), pip (--user upgrade-all too fragile), choco +
#     scoop (Windows managers the Unix cron doesn't run). cask is UPDATED via `brew upgrade --cask` (no dedicated
#     updater). A NEW manager with neither a coverage rule here NOR an exclusion entry FAILS (forces a decision).
upd_excluded="cargo go pip choco scoop"
updmiss=""
for p in $s_install_hook; do
  case " $upd_excluded " in *" $p "*) continue;; esac
  case "$p" in
    apk)    grep -qF 'apk upgrade'         "$UPD" || updmiss="$updmiss apk";;
    apt)    grep -qF 'apt-get upgrade'     "$UPD" || updmiss="$updmiss apt";;
    brew)   grep -qF 'brew upgrade'        "$UPD" || updmiss="$updmiss brew";;
    cask)   grep -qF 'brew upgrade --cask' "$UPD" || updmiss="$updmiss cask";;
    dnf)    grep -qF 'dnf update'          "$UPD" || updmiss="$updmiss dnf";;
    gem)    grep -qF 'gem update'          "$UPD" || updmiss="$updmiss gem";;
    npm)    grep -qF 'npm update -g'       "$UPD" || updmiss="$updmiss npm";;
    pacman) grep -qF 'pacman -Syu'         "$UPD" || updmiss="$updmiss pacman";;
    pipx)   grep -qF 'pipx upgrade-all'    "$UPD" || updmiss="$updmiss pipx";;
    *)      updmiss="$updmiss $p(no-coverage-rule)";;
  esac
done
[ -z "$updmiss" ] && pass "every cnf install-manager is update-covered by the Monday cron OR a documented exclusion (#275 class locked)" || fail "update-system does NOT keep these cnf install-managers current + they are not excluded:$updmiss — a tool lazy-installed via them silently rots (the #275 npm/pipx/gem class)"

say "provider-consistency: $P passed, $F failed"
[ "$F" -eq 0 ]
