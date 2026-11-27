# Design

**Architect Role:** assigned

Use checked fixture boundary types for JSON parsed in the tests. Explicitly return promises from promise-based mocks with synchronous implementation and reject promises on the mock error branches. Keep the canonical catalog fixture merge and current release generation assertions intact.

Verify the shared control-plane test lint profile, the test compiler, and the existing offline request, storage, and release-builder runtime tests using local fixtures.
