# Design

**Architect Role:** assigned

Use current Zod URL and datetime constructors with the existing constraints. Exclude CLI envelope fields from downstream payloads according to the receiving schemas. Retain runtime guards for absent map entries and platform-specific flags. Use the invocation schemas for fixed policy and manager literals while retaining dynamic identity, unit, ownership, and permit checks.

The CLI parses operations through `OperationSchema`. Its managed-directory branch requires `candidateMode: 0o700`, and artifact derivation emits only `targetMode: 0o700`, also required by `ArtifactDerivationResultSchema`. The artifact closure still matches each missing root by exact path and requires its selected directory task and dependency. `NativeServiceOperationSchema` and `PrivilegedBrokerServiceDescriptorSchema` both require `manager: 'systemd'`. Status still requires a systemd adapter, and mutation still checks the approved service unit, desired state, phase, and grant binding.

Preserve immediate adapter computation and promise rejection behavior. Normalize unexpected renderer spill rejection values to Error objects with their original causes. Verify the CLI directly under the shared strict profile and through the package gate on Node 24.22.2.
