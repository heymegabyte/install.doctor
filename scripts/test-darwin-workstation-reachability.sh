#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
POST="$ROOT/home/dot_local/bin/post-installx/executable_post-workstation.sh"

require() {
  grep -Fq "$1" "$POST" || { printf 'missing workstation invariant: %s\n' "$1" >&2; exit 1; }
}

darwin_line=$(grep -nF 'if [ "$(uname -s)" = "Darwin" ]; then' "$POST" | head -n1 | cut -d: -f1)
exit_line=$(grep -nF 'if [ "$(uname -s)" != "Linux" ] || [ "${1:-}" = "--converge-only" ]; then' "$POST" | head -n1 | cut -d: -f1)
[ -n "$darwin_line" ] && [ -n "$exit_line" ] && [ "$darwin_line" -lt "$exit_line" ] || {
  printf 'Darwin convergence must precede the non-Linux exit\n' >&2
  exit 1
}

require 'bind to = 127.0.0.1'
require 'space.megabyte.agent-skills-sync.plist'
require 'space.megabyte.langfuse-spool-drain.plist'
require 'MZHPV512HDGL'
require 'zpool set autotrim=off'
require 'systemctl mask apport-autoreport.timer snapd.snap-repair.timer wsdd.service apport.service apport-forward.socket whoopsie.service'
require 'swapon --show=NAME --noheadings'
require '!30min_ram_swapped_out *'
require 'ERROR: PBS_PASSWORD is unavailable'
require 'exit "$RC"'

printf 'darwin-workstation-reachability: PASS\n'
