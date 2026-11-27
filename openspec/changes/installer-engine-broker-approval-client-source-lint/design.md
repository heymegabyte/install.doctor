# Design

**Architect Role:** assigned

Express the existing polling and stream loops without constant conditions. Preserve their exit, timeout, byte-limit, and error paths. Make the abort callback body and HTTP status conversion explicit. Use the current Zod ISO datetime constructor with the existing offset validation.

Run the standard strict source gate, the focused broker approval tests, and the full Installer Engine package suite on Node 24.22.2.
