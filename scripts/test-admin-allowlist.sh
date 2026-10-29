#!/usr/bin/env bash
# O11/O12 — unit-test the pure admin-email allowlist decision (isAllowedAdminEmail) that drives
# requireAdmin's Better Auth SESSION branch (fire #131). Imports the REAL shipped module
# (packages/control-plane/src/admin-allowlist.ts) via node's native TS support (zero drift — it tests the
# ACTUAL function, not a copy). The session-accept path (a signed-in allowlisted user) is integration-gated
# on the OAuth callback registration (O04); this suite verifies the DECISION logic deterministically now.
set -u
say() { command -v gum >/dev/null 2>&1 && gum log --level info -- "$*" || printf '%s\n' "$*"; }
CP="$(cd "$(dirname "$0")/.." && pwd)/packages/control-plane"
MOD="$CP/src/admin-allowlist.ts"
export MOD
if [ ! -f "$MOD" ]; then
  printf 'FAIL admin-allowlist module missing: %s\n' "$MOD"
  echo "admin-allowlist: 0 passed, 1 failed"
  exit 1
fi
# Run node from the control-plane dir so Volta selects the modern node that strips TS types natively; the
# repo ROOT pins an older node via Volta which cannot import a .ts module (ERR_UNKNOWN_FILE_EXTENSION).
cd "$CP" || { printf 'FAIL cannot cd to %s\n' "$CP"; echo "admin-allowlist: 0 passed, 1 failed"; exit 1; }
node --input-type=module <<'NODE'
const { isAllowedAdminEmail } = await import(process.env.MOD);
let P = 0, F = 0;
const ok = (d, cond) => { if (cond) { P++; console.log('PASS ' + d); } else { F++; console.log('FAIL ' + d); } };
ok('exact match accepted', isAllowedAdminEmail('a@b.com', 'a@b.com') === true);
ok('case-insensitive match', isAllowedAdminEmail('A@B.Com', 'a@b.com') === true);
ok('surrounding whitespace trimmed', isAllowedAdminEmail('  a@b.com ', 'a@b.com') === true);
ok('comma-separated list member accepted', isAllowedAdminEmail('b@c.com', 'a@b.com, b@c.com, c@d.com') === true);
ok('newline/space-separated member accepted', isAllowedAdminEmail('c@d.com', 'a@b.com\n c@d.com') === true);
ok('non-member rejected', isAllowedAdminEmail('z@z.com', 'a@b.com, b@c.com') === false);
ok('empty email rejected', isAllowedAdminEmail('', 'a@b.com') === false);
ok('undefined email rejected', isAllowedAdminEmail(undefined, 'a@b.com') === false);
ok('null email rejected', isAllowedAdminEmail(null, 'a@b.com') === false);
ok('empty allowlist rejected', isAllowedAdminEmail('a@b.com', '') === false);
ok('undefined allowlist rejected', isAllowedAdminEmail('a@b.com', undefined) === false);
ok('whitespace-only allowlist rejected', isAllowedAdminEmail('a@b.com', '   ') === false);
ok('partial/substring is NOT a match', isAllowedAdminEmail('a@b.co', 'a@b.com') === false);
ok('an entry that is a prefix does not match a longer email', isAllowedAdminEmail('a@b.comX', 'a@b.com') === false);
console.log('admin-allowlist: ' + P + ' passed, ' + F + ' failed');
process.exit(F === 0 ? 0 : 1);
NODE
