#!/usr/bin/env bash
# SOFTWARE_GROUP source-of-truth gate (removal-wave-two DPS-11).
#
# The reference page docs/cli/variables.md quoted a bare value set
# ("Basic, Server, Standard, Full") with a single "Full" default, but the
# actual runtime has three facts it omitted:
#   * .chezmoi.yaml.tmpl appends a "-Desktop" suffix automatically on desktop
#     sessions (so "Standard" -> "Standard-Desktop"), which is the value
#     .host.softwareGroup actually records and templates re-export.
#   * Chezmoi falls back to "Standard" when SOFTWARE_GROUP is unset, while
#     scripts/provision.sh defaults to "Full" -- two distinct defaults.
#
# This gate binds the doc to the source: the documented value set must name all
# four base groups, the "-Desktop" suffix auto-append, and the Chezmoi
# "Standard" fallback, and the source defaults must stay as-is. Hermetic:
# repo-only, no network, no host, no secret.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

P=0
F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

VARIABLES_DOC="docs/cli/variables.md"
CHEZMOI_YAML="home/.chezmoi.yaml.tmpl"
PROVISION="scripts/provision.sh"

# The single SOFTWARE_GROUP row from the variables reference table.
# shellcheck disable=SC2016 # backticks are literal Markdown, not command substitution
row="$(grep -E '^\| `SOFTWARE_GROUP` ' "$VARIABLES_DOC")"

# A1 — the documented value set names all four base groups.
for group in Basic Server Standard Full; do
  if printf '%s' "$row" | grep -Fqw "$group"; then
    pass "variables.md documents base group '$group'"
  else
    fail "variables.md SOFTWARE_GROUP row is missing base group '$group'"
  fi
done

# A2 — the doc states the "-Desktop" suffix is appended automatically.
if printf '%s' "$row" | grep -Fq -- '-Desktop'; then
  pass "variables.md documents the -Desktop suffix auto-append"
else
  fail "variables.md SOFTWARE_GROUP row omits the -Desktop suffix auto-append"
fi

# A3 — the doc states Chezmoi's fallback default (Standard), resolving the
#       dual-default drift instead of implying a single "Full" default.
if printf '%s' "$row" | grep -Fq -- 'Standard'; then
  pass "variables.md SOFTWARE_GROUP row references the Chezmoi Standard fallback"
else
  fail "variables.md SOFTWARE_GROUP row omits the Chezmoi Standard fallback"
fi

# A4 — source truth: .chezmoi.yaml.tmpl defaults SOFTWARE_GROUP to "Standard".
if grep -qE 'default "Standard" \(env "SOFTWARE_GROUP"\)' "$CHEZMOI_YAML"; then
  pass "chezmoi.yaml.tmpl defaults SOFTWARE_GROUP to Standard"
else
  fail "chezmoi.yaml.tmpl no longer defaults SOFTWARE_GROUP to Standard (doc/source drift)"
fi

# A5 — source truth: provision.sh defaults SOFTWARE_GROUP to "Full".
if grep -qE 'SOFTWARE_GROUP="Full"' "$PROVISION"; then
  pass "provision.sh defaults SOFTWARE_GROUP to Full"
else
  fail "provision.sh no longer defaults SOFTWARE_GROUP to Full (doc/source drift)"
fi

# A6 — non-vacuity: a stripped copy of the row missing "-Desktop" must fail A2.
# shellcheck disable=SC2016 # backticks are literal Markdown, not command substitution
if printf '%s' "$row" | grep -Fq -- '-Desktop' && ! printf '%s' "$row" | sed 's/`-Desktop`[^;]*//' | grep -Fq -- '-Desktop'; then
  pass "self-test: stripping the -Desktop clause changes the row (gate is not vacuous)"
else
  fail "self-test: the -Desktop clause could not be stripped (gate may be vacuous)"
fi

printf 'software-group-doc-drift: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
