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
provider, the pinned on-demand Desktop Tools skill, its ten typed lifecycle tools, and
workspace-local inspection. ProjectSites is the customer inference boundary, prefers DeepSeek,
and does not use LiteLLM.

`contracts/typed-tools.json` is the signed runtime allowlist for discover, validate, plan,
approve, apply, verify, status, resume, configuration rollback, and deprovision preview.
Their implementation lives in the installer engine: model input cannot supply an engine
invocation, executable, shell text, state root, plan body, or journal. Apply and rollback
consume approvals issued by an out-of-band consent broker; the engine independently owns
schema validation, mutation locks, durable evidence, verification, and rollback fencing.

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

Both `run` and `service` require a strict `--session-context` JSON file. It binds the
session/run and optional parent identifiers to the machine fingerprint, actor, authorization
scopes, authorization expiry, profile revision, release, prompt, runtime, pinned skills, and
permitted tools. `service` copies the validated context into protected persistent state.
Immediately before OpenCode launch, `run` durably creates separate History and recording
headers under `<state>/history` and `<state>/recordings`. Conflicting or failed header writes
abort before process creation. These initialization headers always say
`captureComplete: false`; only subsequent recording and verification work may establish a
complete capture, so an evidence-storage failure cannot be presented as success.

`src/encrypted-recording.mjs` provides the signed, local recording boundary for sanitized
asciicast v3 output, resize, marker, and exit events. It requires explicit output-only consent,
an injected sanitizer, and a caller-supplied in-memory 256-bit secret `KeyObject`; it accepts
neither raw keyboard input nor environment capture. Each cast line is independently protected
with AES-256-GCM and sequence-bound authenticated data. Retention evaluation is preview-only,
while export and deletion require separate actor-bound authorization and policy permission.
Capture status is a protected sidecar that remains visibly incomplete until an exit event is
durably stored. The current supervisor does not yet own a PTY capture stream or an enrolled
recording-key provider, so its prelaunch header truthfully records
`consent-key-and-capture-stream-not-attached` instead of pretending recording is active.

Build outputs are deterministic inputs to the release builder:

- `dist/desktop-tools-supervisor.mjs`
- `dist/desktop-tools-tools.tar.gz`

Run `npm test` and `npm run build`. The generated `dist/` directory is deliberately not
versioned; the production release workflow builds it from the reviewed source.
