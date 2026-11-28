> **Architect:** codex
> **Architect Role:** assigned

## Why

The Mac hook unloads and reloads a standalone launcher on every apply. The enrolled Mac already has a signed CuaDriver.app daemon owned by its GUI session.

## What Changes

Use the upstream signed-app LaunchAgent and preserve the running daemon and existing launch policy.

## Capabilities

### New Capabilities

- `cua-macos-launcher`: Prepare signed-bundle autostart without interrupting active Cua sessions.
