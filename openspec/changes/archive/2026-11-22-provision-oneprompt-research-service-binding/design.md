# Design: Research consumer service bindings

**Architect:** codex
**Architect Role:** assigned

## Boundary

`consumerBindings` is separate from resources owned by the research Worker. Each entry identifies the consumer Worker and environment, its binding name, the declared research target and environment, an optional named entrypoint, and an opaque server-controlled authority grant reference.

The manifest contains no endpoint URL, bearer token, credential, or user-supplied authority. A Cloudflare service binding grants transport reachability only; the research Worker must derive caller authority at its trusted entrypoint and enforce tenant policy.

## Validation

- Consumer id and consumer-service/binding pairs are unique.
- Consumer and target environments equal the manifest environment.
- The target service exactly equals the declared canonical research Worker.
- Authority references use a non-secret `theme-authority://...` identifier.
- One consumer binding cannot overwrite an existing binding during rollback; only a newly created binding may be removed.

## Planning

For each declaration the planner emits `ensure-consumer-service-binding` followed by `validate-consumer-authority`, both deterministic and `mutationAllowed: false`. A separately authorized reconciler may later interpret these actions.
