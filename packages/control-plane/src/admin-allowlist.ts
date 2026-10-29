// Admin-email allowlist membership (O11/O12) — the pure decision that drives requireAdmin's Better Auth
// SESSION branch (fire #131). An operator sets AID_ADMIN_EMAILS (a Worker secret) to the comma-separated
// admin emails; a signed-in user whose verified provider email is in that list is authorized for admin
// routes (the forward path to retiring the AID_ADMIN_TOKEN bearer once sign-in completes).
//
// Kept in its OWN module with NO Worker imports so it is node-importable: scripts/test-admin-allowlist.sh
// unit-tests the REAL shipped function (zero drift). Case-insensitive, trims, comma/space/newline
// separated, ignores empties, and matches WHOLE entries only (never a prefix/substring).
export function isAllowedAdminEmail(
  email: string | undefined | null,
  allowlistCsv: string | undefined | null,
): boolean {
  if (!email || !allowlistCsv) return false;
  const norm = (s: string): string => s.trim().toLowerCase();
  const target = norm(email);
  if (!target) return false;
  return allowlistCsv
    .split(/[\s,]+/)
    .map(norm)
    .filter(Boolean)
    .includes(target);
}
