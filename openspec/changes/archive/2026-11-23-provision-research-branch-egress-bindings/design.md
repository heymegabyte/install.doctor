# Design: Internal Deep Research runtime topology

**Architect:** codex
**Architect Role:** assigned

## Ownership boundary

`runtimeServices` declares the Workers that own the API/Workflow, named branch entrypoint, and policy-enforced egress boundary. `internalBindings` declares directed bindings owned by those services. Product `consumerBindings` remains a separate product-to-platform authority boundary.

The required topology is:

`DeepResearchWorkflow` owner —`RESEARCH_BRANCH_EXECUTOR`→ branch service / `ResearchBranchService` —`RESEARCH_EGRESS`→ declared egress-policy service.

The branch binding carries only bounded, non-secret named-entrypoint properties. Its `egressPolicyReference` must exactly equal the egress binding policy reference. The endpoint must be credential-free HTTPS without query, fragment, or embedded credentials. Browser policy accepts only `unavailable` in this change; declaring a Browser Rendering resource is not evidence of safe navigation.

## Validation

- Runtime service IDs and service names are unique and share the manifest environment and Cloudflare account reference.
- Every internal binding has one declared source and target service; source-plus-binding pairs are unique.
- The Workflow binding is named `RESEARCH_BRANCH_EXECUTOR`, targets the branch service, and names `ResearchBranchService` with exact validated properties.
- The branch egress binding is named `RESEARCH_EGRESS`, targets a service explicitly classified as policy egress, and carries the matching `theme-egress://` reference.
- No internal binding may contain credentials, arbitrary headers, direct-fetch fallback, or a target outside the declared topology.

## Planning and rollback

The planner emits `ensure-internal-service-binding`, `validate-branch-entrypoint-props`, and `validate-egress-policy-binding` actions. All remain `mutationAllowed: false`. Rollback preserves existing bindings and removes only a newly created binding under separately authorized apply.
