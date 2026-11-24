# Proposal: Provision theme.tools Deep Research

**Architect:** codex

**Architect Role:** assigned

## Why

theme.tools now owns a Cloudflare-native Deep Research runtime, but install.doctor lacks a reusable, validated desired-state contract for its Workers, D1, R2, KV, Queues, Durable Objects, Workflows, Browser Rendering, Workers AI, service bindings, and Infisical references. Product repositories must not reproduce account and host provisioning logic.

## What Changes

- Add a strict secret-free provisioning manifest and deterministic dry-run planner to aid-core.
- Require fixed Infisical references and one independently revocable workload identity.
- Model idempotent resource creation/update, validation, and rollback metadata without authorizing production mutation.
- Document exact external requirements for later account-bound application.

