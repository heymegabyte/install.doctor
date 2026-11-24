# Proposal: Provision research consumer service bindings

**Architect:** codex
**Architect Role:** assigned

## Why

The research desired-state contract models resources owned by the canonical research Worker, but cannot declare a product Worker binding into that service. OnePrompt now has a locally verified `RESEARCH` Fetcher boundary; reusable host provisioning needs a value-free, fail-closed declaration before an authorized Cloudflare apply can occur.

## What Changes

- Add typed consumer service-binding declarations with explicit consumer, target, environment, entrypoint, and server-controlled authority grant reference.
- Validate uniqueness, declared targets, environment alignment, and absence of URL/token material.
- Emit deterministic, non-mutating binding and authority-validation actions with narrow rollback metadata.
- Declare the OnePrompt staging binding in the canonical staging fixture and document exact apply blockers.

## Impact

This extends the experimental `@install-doctor/aid-core/theme-tools-research-provisioning` dry-run contract only. It performs no Cloudflare mutation, secret resolution, deployment, or grant creation.
