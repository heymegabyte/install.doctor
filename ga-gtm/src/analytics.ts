/**
 * GTM loader + bootstrap. GA4 is configured INSIDE the GTM container (not a
 * second gtag) so there's one tag manager. Idempotent + SSR-safe.
 */
import { setDefaultConsent, gtag, type ConsentChoice } from './consent';

export interface SiteAnalyticsConfig {
  /** The site domain this config belongs to (matches registry.json key). */
  domain: string;
  /** GTM container id, e.g. GTM-XXXXXXX. */
  gtm_container_id: string;
  /** Optional GA4 measurement id (G-XXXXXXX) if configuring GA4 directly too. */
  ga4_measurement_id?: string;
}

let loaded = false;

/**
 * Inject GTM once. Call `setDefaultConsent()` FIRST (or use `initAnalytics`)
 * so Consent Mode v2 defaults are on the dataLayer before GTM evaluates tags.
 */
export function loadGtm(containerId: string): void {
  if (loaded || typeof document === 'undefined') return;
  if (!/^GTM-[A-Z0-9]+$/.test(containerId)) {
    console.warn(`[ga-gtm] invalid GTM container id: ${containerId}`);
    return;
  }
  loaded = true;
  (window.dataLayer = window.dataLayer || []).push({
    'gtm.start': Date.now(),
    event: 'gtm.js',
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
  document.head.appendChild(script);
}

/** The `<noscript>` iframe for SSR to inject at the TOP of `<body>`. */
export function gtmNoscriptHtml(containerId: string): string {
  const id = encodeURIComponent(containerId);
  return `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
}

/**
 * One-call bootstrap: Consent Mode v2 defaults → GTM load → optional direct
 * GA4 config. The canonical entry a site calls on first paint.
 */
export function initAnalytics(
  config: SiteAnalyticsConfig,
  opts?: { defaultConsent?: Partial<ConsentChoice> },
): void {
  setDefaultConsent(opts?.defaultConsent);
  loadGtm(config.gtm_container_id);
  if (config.ga4_measurement_id) {
    gtag('js', new Date());
    gtag('config', config.ga4_measurement_id);
  }
}
