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

The [50-initiative program ledger and operating model](program.md) keeps ownership, admission gates,
critical path, evidence freshness, and capability truth machine-checkable across the longer program.

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

## Headless enrollment and recovery

The target does not need a browser or graphical session. On the target, use the shipped compatibility
client with browser opening disabled:

```bash
HEADLESS_INSTALL=true desktop-tools-pair
```

Keep that terminal visible. It prints a bounded verification code, approval URL, and expiry but never
prints the private polling authority or resulting credential. On a separate trusted phone or computer,
open the printed HTTPS URL and compare the complete code, machine label and fingerprint, immutable
profile revision, requested scopes, actor, and expiry before approving. A QR code or opened URL is not
approval. Deny the request if any value differs; the target terminates without writing a credential.

Timeout, denial, cancellation, revocation, or loss of protected polling state requires a new pairing
request. Do not reuse a code or copy a token between machines. After approval, confirm the granted
identity and scopes with `desktop-tools status`. Revoke a lost or retired device through the authenticated
device-management surface, then run `HEADLESS_INSTALL=true desktop-tools-pair --force` to create a new
identity. Revocation is not deletion: retain signed run and recovery evidence that still depends on the
old identity.

Today this command uses the compatibility control-plane pairing route. The profile-subdomain bootstrap
must not be described as production enrollment until its OIDC owner-session and disposable canary gates
are verified. The browserless client is covered with a no-op browser fixture, terminal denial, bounded
polling, and owner-only atomic credential persistence.

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
