## Approach

Use current Zod constructors and explicit predecessor checks. Derive the unsigned prompt context from the signed schema's shape and validate the optional digest before omitting it from the canonical bytes. Preserve fail-closed identity, digest, ordering, and drift decisions.
