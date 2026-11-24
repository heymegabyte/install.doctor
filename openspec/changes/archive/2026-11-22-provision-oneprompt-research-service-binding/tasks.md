# Tasks: Research consumer service bindings

- [x] Add failing validation and planning tests for the OnePrompt staging binding, duplicates, target/environment drift, secret material, and rollback scope.
- [x] Extend the value-free provisioning manifest and deterministic dry-run planner.
- [x] Update the staging fixture and operations documentation.
- [x] Run aid-core tests, scoped strict OpenSpec validation, and focused secret scans.
- [x] Record Cloudflare apply, authority enrollment, staging observation, and production rollout as external until executed.

## Evidence — 2026-11-22

- Red phase: the aid-core suite rejected the new `consumerBindings` field before implementation.
- `cd packages/aid-core && npm test`: PASS, 242/242 tests including the complete canonical staging fixture.
- `npx openspec validate provision-oneprompt-research-service-binding --strict --no-interactive`: PASS.
- Focused plaintext/private-key/Bearer scan across the manifest, implementation, and operations document: no matches.
- Repository-wide strict OpenSpec validation: 18 items pass; two unrelated pre-existing changes (`ai-finops-mission-control-observatory` and `sync-multi-category-telemetry-guard`) fail because they contain no delta and do not declare `skip_specs`.

Cloudflare apply, canonical research Worker deployment, D1/resource provisioning, OnePrompt binding creation, server-controlled caller grant enrollment, staging telemetry, and production rollout remain external and unverified. Exact account credentials, deployment permissions, approved budget/window, and a deployed trusted research entrypoint are required.
