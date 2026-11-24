# theme-tools-research-provisioning Specification

## Purpose
Define the value-free, idempotent install.doctor boundary for planning theme.tools Deep Research Cloudflare resources and fixed Infisical workload references without granting mutation authority or storing credentials.

## Requirements

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

### Requirement: Idempotent dry-run plan

The provisioning planner SHALL produce stable resource actions, validation checks, and rollback metadata without mutating Cloudflare or Infisical.

#### Scenario: Repeated planning

- **WHEN** the same validated manifest is planned twice in dry-run mode
- **THEN** both plans are identical and explicitly report mutation as disallowed

### Requirement: Value-free broker access binding

install.doctor SHALL declare an HTTPS theme.tools research endpoint and SHALL bind its service credential through the fixed `THEME_RESEARCH_SERVICE_TOKEN` Infisical reference without storing or resolving the credential value.

#### Scenario: Complete broker binding

- **WHEN** the desired-state manifest declares the HTTPS endpoint and matching fixed-leaf service-token reference
- **THEN** the dry-run plan emits deterministic non-mutating configuration and secret-reference actions

#### Scenario: Missing or unsafe broker binding

- **WHEN** the endpoint is not HTTPS, contains credentials, or the fixed service-token reference is absent
- **THEN** validation fails before any provider operation

### Requirement: Explicit consumer service-binding desired state

install.doctor SHALL validate value-free consumer-to-research service-binding declarations with explicit consumer and target environments and a server-controlled authority grant reference.

#### Scenario: OnePrompt staging binding

- **WHEN** OnePrompt declares a `RESEARCH` service binding to the canonical staging research Worker in the same declared environment
- **THEN** the planner emits deterministic non-mutating binding and authority-validation actions
- **AND** the plan contains no endpoint credential or token.

#### Scenario: Ambiguous or unsafe consumer binding

- **WHEN** a consumer binding duplicates a consumer binding name, targets an undeclared service or environment, or contains credential-like material
- **THEN** validation fails before any provider operation.

### Requirement: Narrow consumer-binding rollback

The planner SHALL preserve an existing binding and SHALL authorize removal only for a binding newly created by a separately authorized apply.

#### Scenario: Dry-run rollback metadata

- **WHEN** a consumer-binding action is planned
- **THEN** its rollback metadata preserves any existing binding and removes only a newly created binding.

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

### Requirement: One authoritative egress policy binding

install.doctor SHALL require ordinary search and source retrieval to traverse the declared `RESEARCH_EGRESS` service binding and SHALL match its policy reference to the branch entrypoint properties.

#### Scenario: Matching policy

- **WHEN** the branch and egress binding carry the same non-secret policy reference and the target is classified as policy egress
- **THEN** the planner emits an egress-policy validation action.

#### Scenario: Direct or mismatched egress

- **WHEN** the egress target is undeclared, not policy-enforcing, permits global-fetch fallback, or carries a different policy reference
- **THEN** validation fails before any deployment or network operation.
