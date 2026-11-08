# Desktop Tools runtime

This package builds the local supervisor boundary shipped in the signed Desktop Tools
release closure. It is intentionally not a general process runner.

The supervisor accepts only `validate`, `prepare`, `run`, `service`, and `status`. Before
launching OpenCode it verifies the pinned executable's SHA-256 and reported version,
creates user-owned `0700` state, installs a persistent local server credential as `0600`,
removes inherited credentials from the child environment, denies OpenCode shell/edit and
external-directory permissions, and binds the server to `127.0.0.1` on an unprivileged port.
The generated OpenCode 2 configuration hard-denies ambient providers, integrations, plugins,
skills, MCP servers, and tools before allowing only the ProjectSites
provider, the pinned on-demand Desktop Tools skill, its typed read/plan/status tools, and
workspace-local inspection. ProjectSites is the customer inference boundary, prefers DeepSeek,
and does not use LiteLLM.

OpenCode 2.2.5 does not enforce the later `websearch.use` policy action. Desktop Tools therefore
does not rely on it: the ordered v2 permission list begins with a deny-all rule and contains no
`websearch` exception, so web search remains denied by the pinned runtime's supported permission
boundary.

The enrollment boundary must place the short-lived inference credential at
`<state>/config/inference-token` as a user-owned `0600` regular file. OpenCode receives only a
`{file:...}` reference to it; no provider token is inherited from the launching shell or encoded
in the generated configuration, service definition, arguments, or logs. A missing, malformed,
linked, shared, or over-broad credential file stops launch.

`service` installs verified immutable copies of the supervisor and pinned OpenCode runtime
under protected state, then emits hardened user-service definitions for systemd and launchd.
It does not activate them; the provisioning engine remains responsible for preview,
consent, atomic installation, validation, activation, and rollback.

Build outputs are deterministic inputs to the release builder:

- `dist/desktop-tools-supervisor.mjs`
- `dist/desktop-tools-tools.tar.gz`

Run `npm test` and `npm run build`. The generated `dist/` directory is deliberately not
versioned; the production release workflow builds it from the reviewed source.
