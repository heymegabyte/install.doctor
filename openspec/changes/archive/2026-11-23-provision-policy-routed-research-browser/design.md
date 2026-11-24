# Design: policy-routed Deep Research Browser Run provisioning

**Architect:** codex
**Architect Role:** assigned

## Decision

The branch service receives a Browser binding plus `RESEARCH_BROWSER_EGRESS`, targeting the named `ResearchBrowserEgressService`. That entrypoint receives the canonical `RESEARCH_EGRESS` binding and the fixed `RESEARCH_BROWSER_DESCRIPTOR_KEY` secret binding. All services share the manifest's Cloudflare account and environment. The branch properties select `policy_routed_v1` and the exact reserved hostname `research-browser.invalid`.

The manifest stores only the Infisical reference for the descriptor key. The planner never resolves or prints its value. The browser-egress binding cannot declare a global-fetch fallback, and the ordinary and browser routes terminate at the same policy-egress service.

## Rejected alternatives

- Direct Browser Run navigation to provider HTTPS origins: Cloudflare's `outboundByHost` does not intercept HTTPS and would bypass canonical egress.
- An arbitrary browser hostname: retrieved content must not choose the outbound route.
- Reusing the broker service token as an HMAC key: access credentials and descriptor-signing keys have different authority and rotation lifecycles.
- Deployment from this change: remote mutation remains separately authorized and evidenced.

## Verification

Schema-negative tests cover missing/mismatched Browser bindings, wrong entrypoint/hostname, absent descriptor-key reference, cross-environment/account wiring, and direct-fetch fallback. Positive tests prove deterministic dry-run actions and absence of secret values. Remote Browser Run semantics remain an external verification item.
