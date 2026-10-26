/**
 * Consent Mode v2 — default-denied, update on the user's choice.
 * Vanilla TS, zero deps (keeps the client analytics bundle tiny; Zod belongs
 * on the SERVER boundary for Measurement Protocol, not in the browser snippet).
 *
 * Implements idea #22 (Consent Mode v2) + a durable per-visitor choice.
 */
export type ConsentValue = 'granted' | 'denied';

export interface ConsentChoice {
  ad_storage: ConsentValue;
  ad_user_data: ConsentValue;
  ad_personalization: ConsentValue;
  analytics_storage: ConsentValue;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

const STORAGE_KEY = 'mb-consent-v2';
const CONSENT_KEYS: (keyof ConsentChoice)[] = [
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
  'analytics_storage',
];

/** gtag command shim — pushes the array-form entry GA / Consent Mode reads. */
export function gtag(...args: unknown[]): void {
  (window.dataLayer = window.dataLayer || []).push(args);
}

const DENIED: ConsentChoice = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
};

/**
 * Call BEFORE loading GTM: sets Consent Mode v2 defaults (EEA-safe — denied
 * until the user opts in, so GA4 still MODELS unconsented traffic). Honors a
 * previously-stored explicit choice immediately.
 */
export function setDefaultConsent(overrides?: Partial<ConsentChoice>): void {
  const stored = readStoredConsent();
  const initial: ConsentChoice = stored ?? { ...DENIED, ...overrides };
  gtag('consent', 'default', { ...initial, wait_for_update: 500 });
  if (stored) gtag('consent', 'update', stored);
}

/** Call when the user accepts/declines in the CMP banner. Persists the choice. */
export function updateConsent(choice: ConsentChoice): void {
  gtag('consent', 'update', choice);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* storage unavailable — consent still applied for this session */
  }
}

export function grantAll(): void {
  updateConsent({
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    analytics_storage: 'granted',
  });
}

export function denyAll(): void {
  updateConsent({ ...DENIED });
}

function readStoredConsent(): ConsentChoice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentChoice>;
    const valid = CONSENT_KEYS.every(
      (k) => parsed[k] === 'granted' || parsed[k] === 'denied',
    );
    return valid ? (parsed as ConsentChoice) : null;
  } catch {
    return null;
  }
}
