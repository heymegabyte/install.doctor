# Design

**Architect Role:** assigned

Represent the runtime availability of the no-follow open flag while preserving the existing fallback. Keep the terminal deadline and callback behavior. Use an immediately evaluated promise for in-memory approval verification so validation failures still reject the promise. Preserve the resolved false result for grant retirement's approval callback.

Verify the strict source gate and focused and complete Installer Engine tests on Node 24.22.2.
