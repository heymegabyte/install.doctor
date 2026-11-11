# Effect migration template

Every legacy mutation remains owned by its existing writer until a migration manifest passes `verifyEffectMigration`. A migration is admitted only when its typed operations and passing test identifiers prove all required evidence; documentation alone is not authority to subtract a writer.

Use `EffectMigrationManifestSchema` from `@install-doctor/installer-engine` as the canonical template. Record:

- the exact legacy path and mutation being replaced;
- every engine-owned typed operation;
- executable precondition and postcondition evidence;
- every exclusive or shared lock domain;
- interruption evidence before, during, and after mutation plus exact resume;
- automatic rollback scope, excluded effect classes, and concrete limits;
- parity fixtures and their passing test;
- the exact legacy path, subtraction assertion, and passing subtraction test.

Call `verifyEffectMigration(manifest, operations, passingTestIds)` in the migration's focused acceptance test. It fails closed when a required category, operation, lock, postcondition, or test is absent. Only after that test passes may the identified legacy mutation be removed. Keep unrelated legacy behavior intact.
