# Apply typed lint to release evidence fixtures

**Architect Role:** assigned

## Why

The release evidence view tests exercise bounded decoding and digest verification. Their test streams and parsed fixtures contain unchecked values that fail the shared typed lint profile.

## What changes

Make number formatting explicit, assert the shape required for fixture mutation, and type the test streams as byte streams.

## Impact

Only the release evidence view test file changes. All checks run locally.
