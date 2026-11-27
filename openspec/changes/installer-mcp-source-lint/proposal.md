## Why

The Installer Engine's MCP stdio entry point is excluded from strict typed lint. Unchecked JSON-RPC message access accounts for most of its baseline findings.

## What Changes

Type untrusted request properties at the parser boundary and enable the existing shared strict source profile for the entry point. Retain descriptor-bound engine execution and consent checks.
