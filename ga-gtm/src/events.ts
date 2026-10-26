/**
 * Typed GA4 events, pushed object-form into the GTM dataLayer. These cover the
 * app-specific events Enhanced Measurement CANNOT infer (sign-up, lead,
 * ecommerce, forms, content selection). Outbound-click / file-download /
 * scroll / site-search are left to Enhanced Measurement (toggled on by the
 * provisioning step) to avoid DOUBLE-COUNTING — the helpers below exist for
 * sites that run with EM off.
 */

/** Object-form dataLayer push for GTM custom events. SSR-safe. */
export function pushEvent(
  event: string,
  params: Record<string, unknown> = {},
): void {
  if (typeof window === 'undefined') return;
  (window.dataLayer = window.dataLayer || []).push({ event, ...params });
}

/** GA4 ecommerce item (subset of the recommended `items[]` shape). */
export interface Item {
  item_id: string;
  item_name: string;
  price?: number;
  quantity?: number;
  item_category?: string;
  [key: string]: unknown;
}

const USD = 'USD';

/** The recommended-event surface. One call per real user moment. */
export const track = {
  // --- engagement / identity (ideas #5–11, #17) ---
  pageView: (path: string, title?: string): void =>
    pushEvent('page_view', { page_path: path, page_title: title }),
  signUp: (method = 'password'): void => pushEvent('sign_up', { method }),
  login: (method = 'password'): void => pushEvent('login', { method }),
  generateLead: (value?: number, currency = USD): void =>
    pushEvent('generate_lead', { value, currency }),
  search: (term: string, resultsCount?: number): void =>
    pushEvent('search', { search_term: term, results_count: resultsCount }),
  selectContent: (contentType: string, id: string): void =>
    pushEvent('select_content', { content_type: contentType, content_id: id }),
  share: (method: string, contentType: string, id?: string): void =>
    pushEvent('share', { method, content_type: contentType, item_id: id }),
  setUserId: (userId: string): void => pushEvent('set_user_id', { user_id: userId }),

  // --- forms (idea #6 — EM does NOT cover forms) ---
  formStart: (formId: string): void => pushEvent('form_start', { form_id: formId }),
  formSubmit: (formId: string): void => pushEvent('form_submit', { form_id: formId }),

  // --- EM-overlap helpers (only if Enhanced Measurement is OFF) ---
  fileDownload: (url: string, ext?: string): void =>
    pushEvent('file_download', {
      file_name: url,
      file_extension: ext ?? url.split('.').pop(),
    }),
  outboundClick: (url: string): void =>
    pushEvent('outbound_click', { link_url: url, outbound: true }),

  // --- ecommerce (ideas #12–13) ---
  viewItem: (items: Item[], value?: number, currency = USD): void =>
    pushEvent('view_item', { currency, value, items }),
  addToCart: (items: Item[], value?: number, currency = USD): void =>
    pushEvent('add_to_cart', { currency, value, items }),
  beginCheckout: (items: Item[], value?: number, currency = USD): void =>
    pushEvent('begin_checkout', { currency, value, items }),
  purchase: (
    transactionId: string,
    items: Item[],
    value: number,
    currency = USD,
    opts?: { tax?: number; shipping?: number },
  ): void =>
    pushEvent('purchase', {
      transaction_id: transactionId,
      value,
      currency,
      tax: opts?.tax,
      shipping: opts?.shipping,
      items,
    }),
};
