# Design

**Architect Role:** assigned

Keep the normalized plan comparison in both resume checks. Serialize the validated plan while excluding only its top-level creation timestamp. Use the validated compensation discriminant to distinguish service, directory, and file snapshots. Keep the first unexpected final-commit artifact in the integrity error.

Use the current Zod timestamp constructor with identical offset and length bounds. Use unknown for untrusted persisted values, including an absent transaction record. Verify all three modules with the shared strict profile and the pinned Installer Engine package tests.
