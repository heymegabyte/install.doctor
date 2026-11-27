# Design

**Architect Role:** assigned

Construct the callback promise explicitly so candidate digest computation still occurs immediately and any exception rejects the promise. Preserve the existing exact digest comparison and publication ordering. Verify the source gate and pinned Installer Engine tests.
