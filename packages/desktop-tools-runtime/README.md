# Desktop Tools runtime

This package builds the local supervisor boundary shipped in the signed Desktop Tools
release closure. It is intentionally not a general process runner.

The supervisor accepts only `validate`, `prepare`, `run`, `service`, and `status`. Before
launching OpenCode it verifies the pinned executable's SHA-256 and reported version,
creates user-owned `0700` state, installs a persistent local server credential as `0600`,
removes inherited credentials from the child environment, denies OpenCode shell/edit
permissions by default, and binds the server to `127.0.0.1` on an unprivileged port.

`service` installs verified immutable copies of the supervisor and pinned OpenCode runtime
under protected state, then emits hardened user-service definitions for systemd and launchd.
It does not activate them; the provisioning engine remains responsible for preview,
consent, atomic installation, validation, activation, and rollback.

Build outputs are deterministic inputs to the release builder:

- `dist/desktop-tools-supervisor.mjs`
- `dist/desktop-tools-tools.tar.gz`

Run `npm test` and `npm run build`. The generated `dist/` directory is deliberately not
versioned; the production release workflow builds it from the reviewed source.
