# Desktop Tools product boundary

Desktop Tools is the product. Install Doctor is the repository and historical provisioning
lineage; `aid`, `aid-pair`, `app.install.doctor`, and Install Doctor state names are compatibility
or migration surfaces, not a parallel product.

The intended user entrypoint is:

```bash
curl -fsSL https://example.desktop.tools | bash
```

The profile URL is permanent, shareable, and nonsecret. It identifies a versioned desired-state
profile but grants no enrollment or mutation authority. A new machine must still complete explicit
cross-device authorization before receiving scoped credentials.

## Current truth

[Capability and migration status](status.md) is generated from the strict registry in
`packages/aid-core/src/product-identity.ts`. `contract-only` means designed but not shipped;
`implemented-unverified` means tested code exists without production proof; `verified-live`
requires runtime evidence. Hosted status uses the same registry through `/api/v1/product-status`.

The current wildcard profile bootstrap, complete device authorization flow, pinned OpenCode
supervisor, and production route remain gated until their respective implementation and canary
tasks are verified. Existing signed Install Doctor bootstrap paths remain compatibility surfaces
until Desktop Tools reaches those gates; they must not silently change profiles or delete state.

## Operating rules

- `desktop-tools` is the canonical executable; `aid` delegates during the compatibility window.
- `desktop-tools-pair` is canonical; `aid-pair` delegates during the compatibility window.
- `DESKTOP_TOOLS_*` is canonical; supported `AID_*` and `INSTALL_DOCTOR_*` values are read-only
  compatibility inputs until explicitly retired.
- Canonical state belongs under the Desktop Tools XDG directory. Legacy state is preserved and
  read as fallback; inspect `desktop-tools migrate --preview` before any future adoption action.
- One portable `ENVIRONMENT.md` carries desired state. Observed state and execution evidence are
  separate and cannot authorize mutation.
- OpenCode may orchestrate approved typed tools; the deterministic installer engine owns planning,
  consent, locks, mutation, journaling, verification, and rollback.
- Customer inference uses the shared ProjectSites route, prefers DeepSeek, and does not introduce
  LiteLLM. Internal development-agent routing follows the separate provider policy.

Historical documents under `docs/aid/` retain attribution and implementation research. Where they
conflict with this boundary or the generated status ledger, they are migration history rather than
current product truth.
