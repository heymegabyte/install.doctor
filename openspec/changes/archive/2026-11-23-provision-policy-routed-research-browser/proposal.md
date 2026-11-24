# Proposal: provision policy-routed Deep Research Browser Run

**Architect:** codex
**Architect Role:** assigned

## Why

theme.tools now exposes a fail-closed Browser Run escalation path that requires a Browser binding, one exact internal outbound Worker, and an Infisical-provisioned descriptor-signing key. The existing install.doctor manifest deliberately declares rendering unavailable and cannot provision the new topology without weakening its value-free boundary.

## Change

- Extend the research desired-state topology with a dedicated browser-egress runtime entrypoint and exact service bindings.
- Declare the Browser Run binding and fixed `research-browser.invalid` routing policy.
- Reference `RESEARCH_BROWSER_DESCRIPTOR_KEY` only through the existing Infisical workload leaf.
- Enable `policy_routed_v1` branch properties only when the complete same-account/environment topology is present.
- Keep all actions deterministic, dry-run, value-free, and non-mutating.

## Impact

The change affects only reusable install.doctor provisioning contracts, fixtures, tests, and operator documentation. It does not deploy Cloudflare resources, resolve secrets, or claim remote Browser Run verification.
