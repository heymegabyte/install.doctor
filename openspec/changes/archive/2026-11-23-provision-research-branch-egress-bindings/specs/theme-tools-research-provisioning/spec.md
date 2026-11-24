# theme-tools-research-provisioning Delta Specification

## ADDED Requirements

### Requirement: Explicit internal research runtime topology

install.doctor SHALL validate separately owned runtime services and directed internal service bindings for the canonical Workflow-to-branch-to-egress chain.

#### Scenario: Complete branch execution topology

- **WHEN** the manifest declares environment-aligned Workflow, branch, and policy-egress services
- **AND** `RESEARCH_BRANCH_EXECUTOR` targets the named `ResearchBranchService` entrypoint
- **AND** that branch service binds `RESEARCH_EGRESS` to the declared policy-egress service
- **THEN** the planner emits deterministic non-mutating internal-binding validation actions.

#### Scenario: Ambiguous topology

- **WHEN** a source or target is undeclared, a source-plus-binding pair is duplicated, an environment differs, or the expected binding/entrypoint name is absent
- **THEN** validation fails before any provider operation.

### Requirement: Bounded branch entrypoint properties

install.doctor SHALL validate the production `ResearchBranchService` property contract without accepting credentials or arbitrary network configuration.

#### Scenario: Safe properties

- **WHEN** the branch binding declares schema `1.0.0`, a stable provider ID, credential-free HTTPS endpoint, honest readiness, bounded retention and fetch concurrency, a `theme-egress://` policy reference, and Browser Rendering as unavailable
- **THEN** the properties are accepted and represented in the deterministic plan.

#### Scenario: Unsafe properties

- **WHEN** the endpoint contains credentials/query/fragment, bounds are exceeded, readiness is invalid, the policy reference is malformed, or Browser Rendering is enabled without equivalent outbound policy
- **THEN** validation fails before any provider operation.

### Requirement: One authoritative egress policy binding

install.doctor SHALL require ordinary search and source retrieval to traverse the declared `RESEARCH_EGRESS` service binding and SHALL match its policy reference to the branch entrypoint properties.

#### Scenario: Matching policy

- **WHEN** the branch and egress binding carry the same non-secret policy reference and the target is classified as policy egress
- **THEN** the planner emits an egress-policy validation action.

#### Scenario: Direct or mismatched egress

- **WHEN** the egress target is undeclared, not policy-enforcing, permits global-fetch fallback, or carries a different policy reference
- **THEN** validation fails before any deployment or network operation.
