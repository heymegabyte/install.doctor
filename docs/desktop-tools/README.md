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

## Profile lifecycle

Profile management is a control-plane operation, not a property of the public URL. Until the
authenticated create, export, and disable operations are implemented and promoted, operators must
not fabricate profiles by adding DNS records or editing the public descriptor binding directly.

1. **Create** — choose a canonical, nonreserved slug and validate the versioned `ENVIRONMENT.md`.
   Creation must commit one immutable revision and digest before the profile becomes discoverable.
   Profile ownership and tenant identity remain private server state.
2. **Use** — after production promotion, invoke the profile only through its root URL:

   ```bash
   curl -fsSL https://example.desktop.tools | bash
   ```

   Sharing that URL grants no enrollment, secret, fleet, or mutation authority. Authorization is a
   separate cross-device action bound to the profile revision and target machine.
3. **Export and standalone recovery** — retain the canonical `ENVIRONMENT.md`, its revision and
   digest, immutable release references, and public trust roots. Exports must exclude credentials,
   tenant metadata, private machine inventory, and observed-state evidence. A standalone recovery
   must use the exported revision exactly; it must not substitute the hosted current revision.
4. **Disable** — disable resolution in authenticated profile state before changing DNS. Disabled,
   private, unknown, and malformed profiles return the same unavailable response and never fall
   back to a default profile. Existing target credentials are revoked separately; disabling a URL
   is not credential revocation.
5. **Recover** — restore a retained export and independently verified signed release. Hosted-service
   recovery cannot require the failed hosted service, and no local secret may be inferred from the
   shareable profile URL.

The public descriptor lives at
`https://example.desktop.tools/.well-known/desktop-tools-profile.json`. It contains only the public
profile ID, slug, revision, and SHA-256 digest, uses bounded caching, and carries no enrollment
authority. The root bootstrap remains fail-closed until the signed stage-zero and canary gates pass.

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
