# theme-tools-research-provisioning Delta Specification

## ADDED Requirements

### Requirement: Complete secret-free desired state

install.doctor SHALL validate a versioned desired-state manifest covering the Cloudflare resources and typed bindings required by theme.tools Deep Research while storing only fixed Infisical references and non-secret identifiers.

#### Scenario: Complete topology

- **WHEN** an operator supplies the Worker, D1, R2, KV, Queue/DLQ, Durable Object, Workflow, Browser Rendering, Workers AI, service-binding, workload identity, and fixed secret-reference declarations
- **THEN** the manifest is accepted without resolving or exposing a secret value

#### Scenario: Plaintext secret or duplicate binding

- **WHEN** a manifest contains credential-like material, duplicate bindings, or a reused workload identity
- **THEN** validation fails before any provider operation

### Requirement: Idempotent dry-run plan

The provisioning planner SHALL produce stable resource actions, validation checks, and rollback metadata without mutating Cloudflare or Infisical.

#### Scenario: Repeated planning

- **WHEN** the same validated manifest is planned twice in dry-run mode
- **THEN** both plans are identical and explicitly report mutation as disallowed

