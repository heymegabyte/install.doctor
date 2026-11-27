# Refresh pinned MCP host manifests with the verified OS baseline

**Architect Role:** assigned

## Why

The vendored canonical host profiles are pinned to a revision whose four macOS and Ubuntu human and automation manifests have no concrete server grants. The canonical control plane now grants the verified Cloudflare-native Megabyte OS public MCP.

## Outcome

Pin the exact new control-plane revision, source digest, artifact digests, and generated host profiles. Prove both hosts and both caller classes receive only the verified baseline grant.

## Acceptance

- The pin references immutable revision `0aec9a5122bcae994cae1a5bf9cc494c56f9b1d5`.
- All five vendored artifacts match their declared SHA-256 digests.
- Both profiles for both supported hosts grant only `megabyte-os-public`.
- Local host controls and canary-only third parties are absent from remote grants.
