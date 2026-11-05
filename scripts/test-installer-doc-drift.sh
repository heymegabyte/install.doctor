#!/usr/bin/env bash
# Installer-reference source-of-truth gate (removal-wave-two DPS-09 + DPS-10).
#
# The installer reference docs must describe what `home/dot_local/bin/executable_installx`
# actually does. Two drift classes shipped:
#   * docs/advanced/installer.md quoted the apt preference order as
#     "snap > flatpak > apt ..." while software.yml installerPreference.apt is
#     "flatpak > snap > apt ..." (the `ubuntu` key is never selected by installx,
#     which resolves apt/dnf/pacman/zypper/apk/linux from the host).
#   * docs documented an `ansible` provider that installx has no `case` for, and
#     four software.yml entries carried dead `ansible:<os>` keys that installx
#     silently ignores (users got a no-op install).
#
# This gate binds the docs to the source: the quoted apt order must equal
# software.yml, the documented provider table must equal installx's `case` set,
# and `ansible` must not reappear. Hermetic: repo-only, no network, no host.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

P=0
F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

INSTALLER_DOC="docs/advanced/installer.md"
SOFTWARE_DOC="docs/customization/software.md"
HEADER_PARTIAL="scripts/partials/software.yml.header"
INSTALLX="home/dot_local/bin/executable_installx"
SOFTWARE_YML="software.yml"

# Extract the provider names from a "Supported Installation Methods" table.
doc_providers() {
  # shellcheck disable=SC2016 # backticks are literal Markdown, not command substitution
  awk '/^## Supported Installation Methods/{in_table=1; next} /^## /{in_table=0} in_table && /^\| `/{print}' "$1" \
    | sed -E 's/^\| `([a-z0-9_-]+)`.*/\1/' \
    | sort -u
}

# Extract the provider `case` labels from installx's install switch (approx. lines 329-460).
installx_providers() {
  sed -n '329,460p' "$INSTALLX" \
    | grep -oE "case '[^']+'" \
    | sed -E "s/case '//; s/'//" \
    | sort -u
}

# A1 — the quoted apt preference order matches software.yml installerPreference.apt.
real_apt_order="$(python3 - "$SOFTWARE_YML" <<'PY'
import sys, yaml
with open(sys.argv[1]) as fh:
    data = yaml.safe_load(fh)
order = (data.get("installerPreference") or {}).get("apt") or []
print(" > ".join(order))
PY
)"
if [ -n "$real_apt_order" ] && grep -Fq "$real_apt_order" "$INSTALLER_DOC"; then
  pass "installer.md apt preference order matches software.yml ($real_apt_order)"
else
  fail "installer.md apt preference order does not match software.yml (expected: $real_apt_order)"
fi

# A2 — the documented provider table equals installx's case set (bidirectional SSOT).
doc_set="$(doc_providers "$INSTALLER_DOC")"
code_set="$(installx_providers)"
code_count="$(printf '%s\n' "$code_set" | sed '/^$/d' | wc -l | tr -d ' ')"
if [ "${code_count:-0}" -ge 30 ] && [ "$doc_set" = "$code_set" ]; then
  pass "documented provider table equals installx case set ($code_count providers)"
else
  only_doc="$(comm -23 <(printf '%s\n' "$doc_set") <(printf '%s\n' "$code_set") | tr '\n' ' ')"
  only_code="$(comm -13 <(printf '%s\n' "$doc_set") <(printf '%s\n' "$code_set") | tr '\n' ' ')"
  fail "documented providers and installx cases disagree (doc-only: ${only_doc:-none}; code-only: ${only_code:-none}; code cases: ${code_count:-0})"
fi

# A3 — planned providers are labelled planned in the table.
# shellcheck disable=SC2016 # backticks are literal Markdown, not command substitution
if grep -Eq '^\| `github`.*\(planned\)' "$INSTALLER_DOC" && grep -Eq '^\| `sbopkg`.*\(planned\)' "$INSTALLER_DOC"; then
  pass "planned providers (github, sbopkg) are labelled planned"
else
  fail "github/sbopkg must be labelled '(planned)' in the provider table"
fi

# A4 — `ansible` is not documented as a provider anywhere, has no installx case,
#       and no software.yml entry carries an ansible provider key.
# shellcheck disable=SC2016 # backticks are literal Markdown, not command substitution
ansible_doc="$(grep -nE '^\| `ansible`' "$INSTALLER_DOC" "$SOFTWARE_DOC" 2>/dev/null || true)"
ansible_example="$(grep -nE '^[[:space:]]+ansible:' "$SOFTWARE_DOC" 2>/dev/null || true)"
ansible_header="$(grep -nE 'ansible:[[:space:]]*professormanhattan' "$HEADER_PARTIAL" 2>/dev/null || true)"
ansible_case="$(grep -nE "case 'ansible'" "$INSTALLX" 2>/dev/null || true)"
ansible_yaml="$(python3 - "$SOFTWARE_YML" <<'PY'
import sys, yaml
with open(sys.argv[1]) as fh:
    data = yaml.safe_load(fh)
hits = []
for name, meta in (data.get("softwarePackages") or {}).items():
    if not isinstance(meta, dict):
        continue
    for key in meta:
        if key.split(":")[0] == "ansible":
            hits.append(f"{name}:{key}")
print("\n".join(hits))
PY
)"
if [ -z "$ansible_doc$ansible_example$ansible_header$ansible_case$ansible_yaml" ]; then
  pass "ansible provider fully removed (docs, example, header partial, installx case, software.yml keys)"
else
  [ -n "$ansible_doc" ] && printf '%s\n' "$ansible_doc" >&2
  [ -n "$ansible_example" ] && printf '%s\n' "$ansible_example" >&2
  [ -n "$ansible_header" ] && printf '%s\n' "$ansible_header" >&2
  [ -n "$ansible_case" ] && printf '%s\n' "$ansible_case" >&2
  [ -n "$ansible_yaml" ] && printf '%s\n' "$ansible_yaml" >&2
  fail "ansible provider residue remains (documented or catalog-declared without an installx case)"
fi

# A5 — non-vacuity: plant an `ansible` row in a temp copy and prove A2/A4 would catch it.
tmp="$(mktemp -t installer-doc-drift).md"
trap 'rm -f "$tmp"' EXIT
awk 'BEGIN{done=0} /^\| `apk`/{if(!done){print "| `ansible`     | planted fixture                               | All                |"; done=1}} {print}' "$INSTALLER_DOC" > "$tmp"
planted_set="$(doc_providers "$tmp")"
if printf '%s\n' "$planted_set" | grep -qx 'ansible' && [ "$planted_set" != "$code_set" ]; then
  pass "self-test: planted ansible table row is detected by the provider-set comparison"
else
  fail "self-test: planted ansible row was NOT detected (gate is vacuous)"
fi

printf 'installer-doc-drift: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
