# Apply strict lint to HTTP step-up fixtures

**Architect Role:** assigned

## Why

The HTTP step-up integration test reads worker and OAuth response JSON through unchecked values. Strict lint can verify these boundaries once the fixture validates the fields it uses.

## What changes

Parse the tested HTTP response shapes, reuse the existing step-up binding schema, and make the local provider mock's asynchronous contract explicit.

## Impact

The change is confined to the HTTP step-up test. Existing authority, replay, revocation, and recovery assertions remain part of verification.
