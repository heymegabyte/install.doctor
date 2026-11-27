# Design

**Architect Role:** assigned

Use the current Zod timestamp constructor with the existing options. Narrow the unique selected candidate while keeping the same exact-one requirement and rejection messages.

Service derivation admits candidates only through `NativeServiceOperationSchema.safeParse`. That schema requires the systemd literal, so the accepted candidate already carries the manager constraint. The task, operation phase, unit, desired state, and authority checks continue to apply.

Verify both modules through the standard strict source gate. Run focused derivation and adjacent broker tests and the pinned Installer Engine suite.
