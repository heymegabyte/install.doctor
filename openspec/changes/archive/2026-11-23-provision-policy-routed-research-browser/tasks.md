# Tasks: provision policy-routed Deep Research Browser Run

- [x] Extend runtime, resource, branch-property, secret-reference, and internal-binding schemas for the exact Browser Run topology.
- [x] Enforce same-account/environment ownership, fixed hostname/entrypoint/binding names, one canonical egress policy, and no direct fallback.
- [x] Update deterministic dry-run planning actions, fixtures, operator documentation, and rollback descriptions without resolving secrets.
- [x] Add positive and negative tests for topology, key reference, host, policy, environment/account, and deterministic value-free output.
- [x] Run aid-core typecheck/tests and strict OpenSpec validation; record remote deployment and Browser Run verification as external.

## Evidence — 2026-11-23

- `cd packages/aid-core && npm test`: PASS; strict TypeScript build and all `247/247` tests passed with zero failures in `1631.116541ms`.
- The canonical staging manifest parses and passes the same strict validator used by the planner.
- The manifest carries only `infisical://workloads/theme-tools-research/RESEARCH_BROWSER_DESCRIPTOR_KEY`; no descriptor-key value is stored or resolved.
- Cloudflare deployment, Browser Run execution, named-entrypoint binding, Infisical value delivery, remote egress enforcement, and production observation remain external and unverified.
