# @install-doctor/ga-gtm

Reusable **GA4 + GTM** client integration consumed by estate sites. The agent skill
`ga-gtm-integration` is the source of truth; this package is the shipped code it
injects. Dependency-light strict TS (no Zod in the browser bundle — Zod lives on the
server boundary for Measurement Protocol).

## Consume

```ts
import { initAnalytics, track, grantAll, denyAll } from '@install-doctor/ga-gtm';
import registry from '@install-doctor/ga-gtm/registry.json';

const cfg = registry.sites[location.hostname];
if (cfg) initAnalytics(cfg);          // Consent Mode v2 defaults → GTM load

// CMP banner:
onAccept(() => grantAll());
onDecline(() => denyAll());

// Real user moments (app-specific — EM can't infer these):
track.signUp('google');
track.generateLead(0, 'USD');
track.purchase('ord_123', [{ item_id: 'sku1', item_name: 'Pro', price: 29 }], 29);
```

SSR: inject `gtmNoscriptHtml(cfg.gtm_container_id)` at the top of `<body>`.

## Server-confirmed events (Worker / Node)

```ts
import {
  sendMeasurementProtocol,
  serverPurchaseEvent,
  clientIdFromGaCookie,
} from '@install-doctor/ga-gtm/server';

// In a Stripe webhook (checkout.session.completed) — deduped with the client
// event via the SAME transaction_id (idea #13):
await sendMeasurementProtocol(
  { measurementId: env.GA4_MEASUREMENT_ID, apiSecret: env.GA4_MP_API_SECRET },
  {
    client_id: storedClientId, // captured at checkout from the _ga cookie
    events: [serverPurchaseEvent({ transactionId: session.id, value: 29, items })],
  },
);
```

Zod-validate the webhook body at the route boundary before calling (estate "Zod at
boundaries"); `assertPayload` is the dep-free backstop. `api_secret` is a Worker secret —
never shipped to the browser.

## Typecheck (verification)

```sh
pnpm typecheck    # flag-based tsc --noEmit, zero runtime deps
```

## The 30-idea coverage map (where each idea lives)

- **Code here:** Consent Mode v2 (#22), typed events — sign_up/login/generate_lead/
  search/select_content/share/form_start/form_submit (#5–11), user_id (#17),
  item-scoped ecommerce view_item/add_to_cart/begin_checkout/purchase (#12), the
  single-tag-manager GTM load.
- **Enhanced Measurement** (toggled on by the skill's provisioning): scroll, outbound
  click, site search, video, file download (#5) — the `fileDownload`/`outboundClick`
  helpers here are only for sites running with EM OFF (avoid double-counting).
- **GTM-side config** (container tags/triggers/variables): cross-domain linker (#2),
  PII redaction (#21), naming/versioning (#23), DebugView/Preview asserts (#24).
- **Server-side** — Measurement Protocol **shipped as code** in `src/server.ts`: Stripe
  `purchase` dedup + backend events (#13, #15), `client_id` from the `_ga` cookie. Still
  infra: server-side GTM (#14), first-party mode (#16).
- **GA4 console / links** (the skill drives via Admin API): custom dimensions/metrics
  (#18), audiences (#19), key events (#20), BigQuery export (#25), Looker Studio (#26),
  retention/IP-anon (#27), anomaly alerts (#28), explorations (#29), Ads/Search-Console
  links (#3), referral exclusions (#4), SEO/GEO tie-in (#30), UTM convention (#1).

Items not yet code here are tracked in the skill's recursive backlog; they're
GTM/GA4/server concerns, not client-snippet code.
