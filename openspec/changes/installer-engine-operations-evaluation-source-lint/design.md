# Design

**Architect Role:** assigned

Use the current Zod ISO datetime constructor while retaining offset and length constraints. Accept unknown values in the deterministic fault JSON replacer and keep its key ordering. Preserve evaluation decisions, serialized evidence, and digest inputs.

Verify the standard lint gate and the focused and full package tests on Node 24.22.2.
