# Align MCP automation secret references

The legacy portal helper requested reversed Cloudflare Access secret names that
are absent from both host-scoped Infisical projects. Align it with the pinned
canonical host manifests so automation can resolve its per-host credentials at
runtime without copying values or falling back to broader credentials.

## Acceptance

- The helper references exactly the two names declared by the pinned canonical automation manifest.
- Tests fail if the standalone descriptor drifts from that manifest.
- Existing local-only MCP registrations and secret values remain untouched.
