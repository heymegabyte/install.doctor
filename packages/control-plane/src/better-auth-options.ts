import { passkey } from '@better-auth/passkey';

type BetterAuthSecrets = {
  BETTER_AUTH_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

type BetterAuthOriginPolicy = {
  baseURL: string;
  trustedOrigins: readonly string[];
};

/**
 * One pure authority for Better Auth's database schema and runtime policy.
 * Production and migration-parity tests must construct auth from this factory.
 */
export function createBetterAuthOptions(
  database: unknown,
  secrets: BetterAuthSecrets,
  originPolicy: BetterAuthOriginPolicy,
) {
  return {
    database,
    baseURL: originPolicy.baseURL,
    secret: secrets.BETTER_AUTH_SECRET,
    session: { freshAge: 5 * 60 },
    trustedOrigins: [...originPolicy.trustedOrigins],
    plugins: [passkey({
      rpID: 'desktop.tools',
      rpName: 'Desktop Tools',
      // Owner authentication is deliberately apex-only. Profile subdomains identify desired state,
      // not principals, and the legacy application origin cannot mint Desktop Tools assertions.
      origin: ['https://desktop.tools'],
      registration: { requireSession: true },
      authenticatorSelection: {
        residentKey: 'preferred' as const,
        userVerification: 'required' as const,
      },
    })],
    socialProviders: {
      github: {
        clientId: secrets.GITHUB_CLIENT_ID,
        clientSecret: secrets.GITHUB_CLIENT_SECRET,
        prompt: 'login',
      },
      google: {
        clientId: secrets.GOOGLE_CLIENT_ID,
        clientSecret: secrets.GOOGLE_CLIENT_SECRET,
        prompt: 'login',
      },
    },
    // Force the limiter on at the edge and persist counters in D1 so isolates cannot
    // independently reset the boundary. Migration 0018 owns this table and its uniqueness.
    rateLimit: {
      enabled: true,
      storage: 'database' as const,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/social': { window: 30, max: 10 },
        '/sign-in/email': { window: 30, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/forget-password': { window: 60, max: 5 },
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
      },
    },
  };
}
