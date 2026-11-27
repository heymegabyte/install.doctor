# Design

**Architect Role:** assigned

Make callback return types explicit and keep the existing process timeout and escalation order. Capture the established termination reason before asynchronous group cleanup. Pass through platform Error objects and retain an unexpected non-Error rejection value as the cause of an Error.

Use the current Zod timestamp constructor for adapter approval responses. Construct the preview promise synchronously so validation errors still reject asynchronously and computation observes input in the same turn.

Verify both modules with the shared strict profile, focused process and tool tests, and the full package suite on Node 24.22.2.
