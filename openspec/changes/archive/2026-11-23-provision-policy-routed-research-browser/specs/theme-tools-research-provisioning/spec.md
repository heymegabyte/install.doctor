## MODIFIED Requirements

### Requirement: Explicit internal research runtime topology

install.doctor SHALL validate separately owned runtime services and directed internal service bindings for the canonical Workflow-to-branch-to-browser-egress-to-policy-egress chain.

#### Scenario: Complete branch execution topology

- **WHEN** the manifest declares environment-aligned Workflow, branch, and policy-egress services
- **AND** `RESEARCH_BRANCH_EXECUTOR` targets the named `ResearchBranchService` entrypoint
- **AND** that branch service binds `RESEARCH_EGRESS` to the declared policy-egress service
- **THEN** the planner emits deterministic non-mutating internal-binding validation actions.

#### Scenario: Ambiguous topology

- **WHEN** a source or target is undeclared, a source-plus-binding pair is duplicated, an environment differs, or the expected binding/entrypoint name is absent
- **THEN** validation fails before any provider operation.

#### Scenario: Complete policy-routed Browser Run topology

- **WHEN** the manifest declares environment/account-aligned Workflow, branch, browser-egress, and policy-egress services
- **AND** the branch has a Browser binding and `RESEARCH_BROWSER_EGRESS` targets `ResearchBrowserEgressService`
- **AND** browser egress delegates through the same no-fallback `RESEARCH_EGRESS` policy service used by ordinary retrieval
- **THEN** the planner emits deterministic non-mutating resource, secret-reference, and binding-validation actions

#### Scenario: Ambiguous or bypassable browser topology

- **WHEN** any source or target is undeclared, cross-account/environment, duplicated, uses another entrypoint, permits direct fetch, or omits the Browser binding
- **THEN** validation fails before any provider operation

### Requirement: Bounded branch entrypoint properties

install.doctor SHALL enable Browser Run only through the fixed policy-routed contract and exact reserved virtual hostname.

#### Scenario: Safe properties

- **WHEN** the branch binding declares schema `1.0.0`, a stable provider ID, credential-free HTTPS endpoint, honest readiness, bounded retention and fetch concurrency, a `theme-egress://` policy reference, and the complete policy-routed Browser Run contract
- **THEN** the properties are accepted and represented in the deterministic plan.

#### Scenario: Unsafe properties

- **WHEN** the endpoint contains credentials/query/fragment, bounds are exceeded, readiness is invalid, the policy reference is malformed, or Browser Rendering is enabled without equivalent outbound policy
- **THEN** validation fails before any provider operation.

#### Scenario: Safe policy-routed properties

- **WHEN** branch properties select `policy_routed_v1` and `research-browser.invalid`
- **AND** all required Browser, browser-egress, descriptor-key, and canonical egress bindings validate
- **THEN** the properties are accepted without resolving a credential

#### Scenario: Unsafe browser properties

- **WHEN** rendering is enabled with another hostname, missing binding, missing key reference, mismatched policy route, or direct network fallback
- **THEN** validation fails before deployment or network I/O

### Requirement: Complete secret-free desired state

install.doctor SHALL reference a distinct `RESEARCH_BROWSER_DESCRIPTOR_KEY` at the manifest's fixed Infisical workload leaf and SHALL never store, resolve, or emit its value.

#### Scenario: Complete topology

- **WHEN** an operator supplies the Worker, D1, R2, KV, Queue/DLQ, Durable Object, Workflow, Browser Rendering, Workers AI, service-binding, workload identity, and fixed secret-reference declarations
- **THEN** the manifest is accepted without resolving or exposing a secret value

#### Scenario: Plaintext secret or duplicate binding

- **WHEN** a manifest contains credential-like material, duplicate bindings, or a reused workload identity
- **THEN** validation fails before any provider operation

#### Scenario: Descriptor-key reference

- **WHEN** policy-routed Browser Run is declared with the exact fixed-leaf key reference
- **THEN** planning emits only a non-mutating secret-reference action

#### Scenario: Missing or value-bearing descriptor key

- **WHEN** the key reference is absent, points outside the workload leaf, or contains key material
- **THEN** validation fails before any provider operation
