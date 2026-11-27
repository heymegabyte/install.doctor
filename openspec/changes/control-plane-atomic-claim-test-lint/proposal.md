# Enforce strict lint for the atomic credential claim fixture

The fixture is excluded from strict lint because its in-memory store and credential dependencies declare async functions without awaits. Resolve those diagnostics and bring the fixture into the normal gate.
