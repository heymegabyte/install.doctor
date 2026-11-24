# Design: Provision theme.tools Deep Research

**Architect:** codex

**Architect Role:** assigned

## Ownership

install.doctor owns reusable Cloudflare account/service provisioning desired state and Infisical reference delivery. theme.tools owns runtime code, schemas, migrations, and application behavior. Product repositories select environment-specific names and policies through thin configuration.

## Contract

The pure aid-core contract declares one Worker runtime plus typed D1, R2, KV, Queue/DLQ, Durable Object, Workflow, Browser Rendering, Workers AI, and service-binding resources. It rejects unknown fields, duplicate bindings, plaintext credential-like values, shared workload identities, production mutation in dry-run mode, and absent rollback metadata.

## Application boundary

The planner returns ordered idempotent actions and checks only. It never calls Cloudflare or Infisical. A future account-authorized reconciler may apply the validated plan after account, identity, budget, and deployment permissions are independently established.

