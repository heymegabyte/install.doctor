# Design

**Architect Role:** assigned

## Immutable refresh

Update the existing pin and vendored artifacts together from the exact canonical commit. Keep the existing digest-verifying loader and atomic merge/rollback behavior unchanged.

## Verification

Load the real vendored profiles through the production verifier, not a bypass, for macOS and Ubuntu. Assert the exact grant and isolation boundaries, then retain the existing corruption, collision, transaction, and rollback tests.
