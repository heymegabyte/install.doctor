# Design

Use the consumer's existing tooling TypeScript project with the pinned shared strict ESLint profile. Narrow unchecked input before it flows into release code, retain defensive checks for untyped JavaScript callers, and use supported Zod APIs with equivalent constraints. Verify against local fixtures and read-only builds.

The publication scripts, Worker source, and test harness have separate compiler projects. A tooling lint result applies only to the files explicitly selected.
