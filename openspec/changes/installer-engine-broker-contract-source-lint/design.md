# Design

**Architect Role:** assigned

Use Zod's current ISO datetime constructor with the existing offset option. Replace the deprecated integer alias with the equivalent integer check in the original validation order. This preserves rejection diagnostics for epochs above JavaScript's safe integer range.

Verify both files through the standard strict source gate. Run focused broker tests and the complete Installer Engine suite on Node 24.22.2.
