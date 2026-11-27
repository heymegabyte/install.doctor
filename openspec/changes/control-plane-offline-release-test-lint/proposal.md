# Apply strict lint to offline release test fixtures

**Architect Role:** assigned

## Why

Strict lint finds unchecked catalog JSON and promise mocks in the control-plane tests for offline release requests and storage. These fixtures exercise authority and publication contracts, so their assertions should remain reliable under the shared lint profile.

## What changes

Narrow parsed fixture data before using it. Keep mock asynchronous APIs consistently promise-based and preserve assertions on missing signing authority, storage behavior, and release generation.

## Impact

The change affects three control-plane test files. No production code or live publication is involved.
