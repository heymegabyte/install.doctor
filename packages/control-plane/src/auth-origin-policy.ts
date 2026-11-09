export const DESKTOP_TOOLS_CANONICAL_AUTH_HOST = 'desktop.tools' as const;
export const DESKTOP_TOOLS_CANONICAL_AUTH_ORIGIN = 'https://desktop.tools' as const;

export const DESKTOP_TOOLS_AUTH_HOSTS = Object.freeze([
  DESKTOP_TOOLS_CANONICAL_AUTH_HOST,
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
      && url.hostname === DESKTOP_TOOLS_CANONICAL_AUTH_HOST;
  } catch {
    return false;
  }
}

/** OAuth state and callback cookies may be created or consumed only at the canonical apex. */
export function requiresCanonicalAuthOrigin(method: string, pathname: string): boolean {
  const verb = method.toUpperCase();
  if (verb === 'POST' && /^\/api\/auth\/sign-in(?:\/|$)/.test(pathname)) return true;
  return verb === 'GET' && /^\/api\/auth\/callback(?:\/|$)/.test(pathname);
}
