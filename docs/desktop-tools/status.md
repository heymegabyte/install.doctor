# Desktop Tools capability and migration status

<!-- Generated from packages/aid-core/src/product-identity.ts. Do not edit by hand. -->

Statuses are evidence boundaries: `contract-only` is designed but not shipped; `implemented-unverified` has tested code but no production proof; `verified-live` requires runtime evidence; `blocked` names an explicit release gate.

## Capabilities

| Capability | Status | Evidence-backed summary |
|---|---|---|
| Canonical product identity | `implemented-unverified` | Strict Desktop Tools identity and compatibility mappings are implemented and unit-tested, but not yet propagated to every consumer.<br />code: `packages/aid-core/src/product-identity.ts`<br />test: `packages/aid-core/test/product-identity.test.mjs` |
| Portable desired-state contracts | `implemented-unverified` | Versioned ENVIRONMENT.md contracts and migrations are implemented as pure code; hosted profile integration is not live.<br />code: `packages/aid-core/src/core.ts`<br />test: `packages/aid-core/test/core.test.mjs` |
| Profile-subdomain bootstrap | `implemented-unverified` | Wildcard profile resolution and signed, profile-bound launchers are implemented and tested; production routing has not been verified live.<br />code: `packages/control-plane/src/index.ts`<br />test: `packages/control-plane/test/control-plane.test.mjs` |
| Cross-device authorization | `implemented-unverified` | Profile-bound target enrollment, polling, credential storage, and desired-state synchronization are integrated and tested; production enrollment has not been verified live.<br />code: `packages/installer-engine/src/cli.ts`<br />code: `scripts/provision.sh`<br />test: `packages/installer-engine/test/device-authorization-cli.test.mjs`<br />test: `scripts/test-desktop-tools-device-enrollment.sh` |
| OpenCode provisioning session | `contract-only` | Pinned OpenCode supervision and typed deterministic mutation authority are specified but not shipped.<br />architecture: `openspec/changes/establish-desktop-tools-bootstrap/specs/agent-provisioning-session/spec.md` |
| Production profile routing | `blocked` | Production wildcard routing remains disabled pending signed-release and canary evidence.<br />architecture: `openspec/changes/establish-desktop-tools-bootstrap/design.md#migration-plan` |

## Compatibility and migration names

| Kind | Legacy name | Canonical target | Disposition | Removal date |
|---|---|---|---|---|
| product | `Install Doctor` | `Desktop Tools` | `migration-only` | not scheduled |
| package | `@install-doctor/aid-core` | `@desktop-tools/core` | `compatibility-alias` | not scheduled |
| package | `@install-doctor/control-plane` | `@desktop-tools/control-plane` | `compatibility-alias` | not scheduled |
| package | `@install-doctor/installer-engine` | `@desktop-tools/installer-engine` | `compatibility-alias` | not scheduled |
| executable | `aid` | `desktop-tools` | `compatibility-alias` | not scheduled |
| environment-prefix | `AID_` | `DESKTOP_TOOLS_` | `compatibility-alias` | not scheduled |
| environment-prefix | `INSTALL_DOCTOR_` | `DESKTOP_TOOLS_` | `compatibility-alias` | not scheduled |
| state-directory | `install.doctor` | `desktop-tools` | `migration-only` | not scheduled |
| state-directory | `aid` | `desktop-tools` | `migration-only` | not scheduled |
| domain | `app.install.doctor` | `desktop.tools` | `migration-only` | not scheduled |
| domain | `install.doctor` | `desktop.tools` | `migration-only` | not scheduled |
