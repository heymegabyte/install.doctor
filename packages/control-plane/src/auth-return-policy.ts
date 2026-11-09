const PAIR_CODE_PATTERN = /^(?:[2-9A-HJ-NP-Z]{4}-){2}[2-9A-HJ-NP-Z]{4}$/;

/**
 * Keep OAuth completion on a small, explicit same-origin surface. Pairing is the only flow that
 * needs to survive sign-in; arbitrary paths, origins, fragments, and extra query parameters fail
 * to the signed-in home page instead of becoming an open redirect.
 */
export function normalizeAuthReturnPath(value: string | undefined): string {
  if (!value || value === '/') return '/';
  try {
    const url = new URL(value, 'https://desktop.tools');
    if (url.origin !== 'https://desktop.tools' || url.pathname !== '/pair' || url.hash) return '/';
    if ([...url.searchParams.keys()].some((key) => key !== 'code')) return '/';
    const code = url.searchParams.get('code')?.trim().toUpperCase() ?? '';
    if (!PAIR_CODE_PATTERN.test(code)) return '/';
    return `/pair?code=${encodeURIComponent(code)}`;
  } catch {
    return '/';
  }
}
