# Design

**Architect Role:** assigned

Keep desired state in the canonical plan digest while emitting only fields accepted by the persisted plan schema. Narrow selected task lookups and retain the existing scheduler and compensation checks across callbacks. Preserve heartbeat timing and complete journal cleanup before the run returns. Start completion telemetry at the same point and keep telemetry observer failures isolated. Retain existing Error objects and preserve other rejection values as causes.

Apply the shared strict profile directly to the source glob. Verify that the standard gate covers every source file and run the focused and full package suites on Node 24.22.2.
