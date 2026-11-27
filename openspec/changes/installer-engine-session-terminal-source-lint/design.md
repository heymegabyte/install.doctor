# Design

**Architect Role:** assigned

Use the current Zod string-format constructors and retain the same event schema rules. Iterate journal events in sequence with locally visible reducer assignments, preserving the sparse-index handling of the previous traversal. Use the validated start discriminant and convert numeric values explicitly in diagnostic strings. Treat promise rejection values as unknown.

Make callback return behavior explicit and keep filter editing on Unicode code points through the string iterator. Verify both modules with the shared strict lint profile and the pinned Installer Engine package tests, including real PTY fixtures.
