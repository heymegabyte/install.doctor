# Apply strict typed lint to release publication tests

**Architect Role:** assigned

## Why

Control Plane release publication tests exercise private storage, signed authority, and activation. Unchecked fixture JSON and loosely typed storage mocks prevent these suites from passing the shared strict typed lint profile.

## What changes

Narrow parsed fixture evidence, type all in-memory storage entries, and express asynchronous mock contracts explicitly while preserving the publication and activation assertions.

## Impact

Scope is limited to the offline bundle and bootstrap release publication test files and their OpenSpec. Verification uses local fixture storage.
