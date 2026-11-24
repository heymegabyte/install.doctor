# Proposal: Provision research branch and policy-egress bindings

**Architect:** codex
**Architect Role:** assigned

## Why

The current Deep Research desired state models one canonical Worker and product-to-platform bindings, but the deployable theme.tools runtime now has an internal Workflow → `ResearchBranchService` → policy-enforced egress chain. Without explicit runtime-service ownership, named-entrypoint properties, and egress-policy binding, a dry-run can appear complete while omitting the branch executor or silently allowing direct global fetch.

## What Changes

- Add explicit runtime-service and internal-binding desired state separate from product consumer bindings.
- Require the exact `RESEARCH_BRANCH_EXECUTOR` and `RESEARCH_EGRESS` chain, environment/account alignment, the `ResearchBranchService` entrypoint, and its bounded credential-free properties.
- Require an opaque `theme-egress://` policy reference shared by the branch entrypoint and egress binding.
- Keep Browser Rendering declared but fail closed as unavailable until its navigation is routed through the same outbound policy.
- Emit deterministic, non-mutating internal-binding, entrypoint-property, and egress-policy validation actions with narrow rollback metadata.

## Impact

This extends the experimental aid-core provisioning planner and staging fixture only. It performs no deployment, Cloudflare mutation, network-policy creation, secret resolution, or provider verification.
