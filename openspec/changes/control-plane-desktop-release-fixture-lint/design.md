# Design

**Architect Role:** assigned

Parse fixture JSON as unknown and validate the fields that each test reads or mutates. Preserve additional fields when a fixture is serialized again. Keep the in-memory storage interfaces promise-based and retain expectations for canonical evidence, signature verification, conditional publication, activation, and rollback.

The canonical strict lint profile verifies all three fixtures once the combined integration removes their exact pending exclusions. This change uses a temporary unignored copy of the same configuration to verify the isolated worktree.
