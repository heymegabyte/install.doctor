> **Architect:** codex
> **Architect Role:** assigned

## Why

The selected Cua recipe accepts forwarded DISPLAY, installed session entries, and other users' display sockets as proof that the target user owns an actual desktop.

## What Changes

Require the current non-root user to own an active local desktop session. Expose a read-only applicability check. Keep headless provisioning functional.

## Capabilities

### New Capabilities

- `cua-session-eligibility`: Verify local desktop ownership before Cua setup.
