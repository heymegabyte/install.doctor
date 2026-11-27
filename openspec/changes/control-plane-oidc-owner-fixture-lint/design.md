# Design

**Architect Role:** assigned

Parse provider redirect, session, enrollment, owner review, and claim responses before property access. Reuse the shared enrollment request contract. Preserve extra review fields so the owner actor omission assertion still sees an unexpected field. Keep provider fetch stubs asynchronous and keep unexpected calls rejected.
