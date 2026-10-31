#!/usr/bin/env bash
# Root chezmoi config/data integrity gate (#304) — the manifests chezmoi reads at INIT/apply to bootstrap
# EVERYTHING. A broken one aborts `chezmoi init`/`apply` ENTIRELY — a harder failure than a single
# chezmoiscript break (#290), because nothing downstream runs:
#   - .chezmoidata.yaml          — the ~26KB data map EVERY template reads; invalid YAML → init fails fleet-wide.
#   - .chezmoiexternal.toml.tmpl — the external-download manifest; invalid TOML → externals can't be fetched.
#   - .chezmoiignore             — the per-OS ignore template; a render error → the wrong files get deployed.
#
# NOTE: .chezmoi.yaml.tmpl (the config template itself) uses INIT-context functions (`writeToStdout`, the
# init-prompt flow) that `chezmoi execute-template` does NOT provide, so it FALSE-REDs under execute-template
# and is DELIBERATELY NOT gated here — it renders fine during a real `chezmoi init` (it provisions machines in
# prod); validating it needs a real init harness (BACKLOG-class, like the chezmoiscript per-OS render-matrix).
# Pure render + parse — no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
skip() { command -v gum >/dev/null 2>&1 && gum style --foreground 244 -- "SKIP $*" || printf '\033[1;90mSKIP\033[0m %s\n' "$*"; }
P=0
F=0
E=/tmp/cc-err.$$
O=/tmp/cc-out.$$

say "root chezmoi config/data integrity (init/apply bootstrap manifests)"

# 1. .chezmoidata.yaml — valid YAML (plain, no template; the data map every template reads at init).
D="home/.chezmoidata.yaml"
if [ ! -f "$D" ]; then
  fail ".chezmoidata.yaml missing — chezmoi would have no data map"
elif python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))' "$D" 2> "$E"; then
  pass ".chezmoidata.yaml is valid YAML (the data map every template reads — invalid = init fails fleet-wide)"
else
  fail ".chezmoidata.yaml is INVALID YAML — chezmoi init would fail on every machine"
  head -3 "$E"
fi

# 2+3 need chezmoi to render — SKIP (not fail) when it's absent (a chezmoi-less CI can't render).
if ! command -v chezmoi > /dev/null 2>&1; then
  skip "chezmoi absent — skipping the render-dependent external/ignore checks"
else
  # 2. .chezmoiexternal.toml.tmpl → renders → valid TOML (the external-download manifest).
  EXT="home/.chezmoiexternal.toml.tmpl"
  if chezmoi execute-template < "$EXT" > "$O" 2> "$E" && python3 -c 'import tomllib; tomllib.load(open("'"$O"'","rb"))' 2> "$E"; then
    pass ".chezmoiexternal.toml.tmpl renders → valid TOML (the external-download manifest)"
  else
    fail ".chezmoiexternal.toml.tmpl renders to INVALID TOML — externals can't be fetched on apply"
    head -3 "$E"
  fi
  # 3. .chezmoiignore → renders cleanly (per-OS ignore template; a render error mis-deploys files).
  IGN="home/.chezmoiignore"
  if chezmoi execute-template < "$IGN" > "$O" 2> "$E"; then
    pass ".chezmoiignore renders cleanly (per-OS ignore template; a render error would mis-deploy files)"
  else
    fail ".chezmoiignore fails to render — chezmoi can't determine ignores (wrong files deployed)"
    head -3 "$E"
  fi
fi

command rm -f "$E" "$O"
say "chezmoi-config: $P passed, $F failed"
[ "$F" -eq 0 ]
