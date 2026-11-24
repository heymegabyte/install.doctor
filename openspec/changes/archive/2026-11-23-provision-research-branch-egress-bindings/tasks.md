# Tasks

- [x] Extend the manifest with strict `runtimeServices` and `internalBindings` schemas.
- [x] Validate the exact Workflow → branch → egress chain, entrypoint properties, environment/account ownership, and policy-reference equality.
- [x] Emit deterministic dry-run actions and narrow rollback metadata for both internal bindings.
- [x] Update the staging fixture and operations documentation without claiming deployment.
- [x] Add negative tests for duplicates, undeclared targets, environment drift, unsafe endpoints, invalid props, policy mismatch, credential fields, and Browser Rendering enablement.
- [x] Run strict OpenSpec validation plus aid-core build and complete tests.

## Evidence — 2026-11-23

- `cd packages/aid-core && npm test`: PASS; strict TypeScript build completed and all `245/245` tests passed in `3784.006417ms`.
- `npx openspec validate provision-research-branch-egress-bindings --strict --no-interactive`: PASS.
- Scoped `git diff --check` across the implementation, tests, staging manifest, operations document, and this task record: PASS.
- The result remains value-free dry-run desired state. No Cloudflare Worker, service binding, egress policy, SearXNG endpoint, D1 migration, or Infisical identity was deployed or provider-verified.
