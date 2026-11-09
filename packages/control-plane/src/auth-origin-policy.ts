export const DESKTOP_TOOLS_AUTH_HOSTS = Object.freeze([
  'desktop.tools',
  'app.install.doctor',
] as const);

export const DESKTOP_TOOLS_TRUSTED_AUTH_ORIGINS = Object.freeze([
  'https://desktop.tools',
  'https://app.install.doctor',
] as const);

/**
 * Authentication is intentionally unavailable on public profile wildcard hosts. They identify
 * desired state, not principals; owners review and approve at the canonical Desktop Tools apex.
 */
export function isCanonicalAuthOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      && url.port === '' && url.pathname === '/' && url.search === '' && url.hash === ''
      && (DESKTOP_TOOLS_AUTH_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}
