# Design: Age-to-Infisical migration with hardened host profiles

**Architect Role:** assigned

## Authority model

Infisical becomes the authority for online operational secret delivery. Age-encrypted install.doctor material remains authoritative only for enumerated bootstrap, independent recovery, and offline-execution exceptions in `config/infisical/offline-secret-exceptions.json`. Interactive human credentials remain outside host automation.

The migration does not infer authority from secret presence. A value may exist in age and Infisical during transition, but the desired-state manifest records exactly one intended runtime authority, its consumers, owner, environment, and rollback state.

## Value-blind inventory and classification

Discovery reads only encrypted file paths, canonical secret names, repository references, consumer declarations, host facts, identity policy, and Infisical metadata that contains no values. It must not invoke age decryption, print secret-bearing environment variables, read rendered targets, or calculate durable value fingerprints.

Every discovered name receives one disposition:

1. `operational-migrate` — required by an evidenced online workload and eligible for Infisical;
2. `offline-exception` — required without network access and documented with owner, consumer, reason, review date, and recovery test;
3. `blocked-unknown` — ambiguous owner, consumer, sensitivity, or environment; no apply authority;
4. `retirement-candidate` — eligible to enter this change's exact-source deletion gates because no required consumer remains.

Aliases and duplicate names must resolve to a canonical name before migration. Conflicting sources, environments, or owners fail planning.

### Source identity across all encrypted stores

Discovery enumerates every regular encrypted entry in the approved general, `secrets-workstation`, and `secrets-wordpress` stores. It assigns a stable source identity from the declared store ID plus normalized repository-relative path and canonical secret name. A ciphertext digest may be recorded for drift detection; plaintext-derived hashes, rendered values, and low-entropy value fingerprints are prohibited.

Source identity, not canonical name alone, is the unit of validation, planning, migration evidence, and retirement. Same-named entries in multiple stores remain distinct sources until an explicit alias/override relationship is declared. Discovery must not silently collapse, shadow, or discard a general, workstation, or WordPress source because another store contains the same filename.

Each source record contains only metadata: source ID, store class, normalized path, canonical name, ciphertext drift digest, declared precedence/alias relation, owner, consumers, classification, validation-record reference, required destinations, offline-exception reference, and lifecycle state. Symlinks, escaped paths, non-regular files, duplicate source IDs, undeclared stores, and ambiguous collisions fail inventory before decryption.

WordPress sources are not host defaults. They map only to explicitly declared WordPress/site workloads and destinations. Workstation sources retain the macOS-only override rules, and general sources remain the default for Ubuntu, other hosts, and workloads unless a reviewed mapping says otherwise.

### Source precedence and explicit directory overrides

The audit found a source-precedence defect: discovery could prefer the `secrets-workstation` inventory whenever it existed, regardless of the selected host. That behavior can leak macOS-specific selection into Ubuntu and other host plans.

Default source selection is host-bound:

- `macos.megabyte.space` uses `secrets-workstation` as its host-specific override inventory, with the general inventory supplying only names not overridden under the reviewed merge contract;
- Ubuntu and every other host use the general encrypted secret inventory by default and must not consult `secrets-workstation`; and
- `--secret-directory <exact-directory>` may replace default source selection only for the one explicitly selected host and one invocation.

The directory override is non-persistent, plan-visible, path-normalized, restricted to an approved encrypted-inventory root, and incompatible with multi-host selection. It grants no additional secret names: profile, project, path, identity, disposition, and destination checks still apply. Missing, ambiguous, overlapping, symlink-escaped, or undeclared directories fail closed.

### AI provider credential placement

Raw AI upstream/provider keys belong only to the Ubuntu-hosted LiteLLM runtime project and identity. They are server-side provider credentials and must not be granted to the macOS developer workstation, placed in its project, or returned through its host profile.

macOS receives only scoped LiteLLM client keys needed to call the gateway. Client keys have bounded model/team/budget authority and cannot administer LiteLLM, enumerate provider credentials, or bypass the gateway to call upstream providers directly. Classification distinguishes `ai-upstream-provider` from `litellm-client`; aliases or names that blur that boundary fail planning.

### Cloudflare Access SSH client credential placement

Repository-wide consumer evidence identifies the four general-store sources `CF_ACCESS_SSH_COOLIFY_CLIENT_ID`, `CF_ACCESS_SSH_COOLIFY_CLIENT_SECRET`, `CF_ACCESS_SSH_UBUNTU_CLIENT_ID`, and `CF_ACCESS_SSH_UBUNTU_CLIENT_SECRET` as outbound controller credentials. The macOS-side `coolify-ssh-proxy.sh` and `ubuntu-ssh-proxy.sh` resolve the corresponding pair immediately before launching `cloudflared access ssh`; the SSH key remains a separate factor. The destination hosts do not consume these values to serve SSH.

The `developer-workstation` profile therefore receives a new exact-name capability such as `cloudflare-access-ssh-client` containing only these four names. The broad `cloudflare` capability's `^CF_` pattern must explicitly exclude all `^CF_ACCESS_SSH_.*_(CLIENT_ID|CLIENT_SECRET)$` names before exact capabilities are added. Pattern ordering alone is not a security boundary: the schema/compiler must support deterministic deny-before-allow or equivalent reserved-name exclusion, reject overlap unless an exact reviewed capability re-admits the name, and show the result in profile diffs.

| Target | Coolify pair | Ubuntu pair | Reason |
| --- | --- | --- | --- |
| `macos.megabyte.space` | allow exact ID + secret | allow exact ID + secret | evidenced local SSH proxy consumer; destination is the dedicated macOS project root |
| `ubuntu.megabyte.space` | deny | deny | SSH target/server, not the outbound Access client; keeping its own bearer token on the target defeats separation |
| `zen.megabyte.space` | deny | deny | provisioning source references client IDs for policy reconciliation, but no runtime host consumer requires either pair |
| `legion.megabyte.space` | deny | deny | no evidenced consumer; shared managed-workstation profile must not imply access |
| `omen.megabyte.space` | deny | deny | provisioning source references the Coolify ID fallback, but no runtime host consumer requires either pair; host is not yet an eligible secret target until explicitly declared |

Zen and Omen provisioning scripts use only client IDs to locate Cloudflare service-token resources while reconciling Access policies. Those control-plane actions should run from an authorized controller/workload and use value-free resource IDs or Cloudflare API lookup where possible; source-code ownership does not grant the destination host either client pair. If a future non-macOS automation runner genuinely initiates SSH, it requires a separately declared workload identity and its own per-caller Access service token, not reuse of the macOS token.

Zen and Legion retain their explicit legacy Global project paths only for credentials independently admitted by their managed-host allowlists. Omen must be added as an explicit host declaration with its reviewed project/path and independently enrolled identity before it can receive any host secret; until then it fails closed. None of these declarations may add the SSH client capability. Client IDs are handled with the same routing and non-disclosure controls as their paired secrets even though an ID alone is not sufficient authentication.

### Cloudflare WARP enrollment credential placement

The general and workstation copies of `CLOUDFLARE_TEAMS_CLIENT_ID` and `CLOUDFLARE_TEAMS_CLIENT_SECRET` are byte-identical but remain two exact source identities. Provider metadata identifies the client ID as the active `Desktopbrew` service token, expiring 2123-06-13, included in one Service Auth policy on the WARP Login App. macOS and Ubuntu WARP clients are currently connected and healthy in the `manhattan` organization; neither host exposes a readable installed MDM token file. The templates select the workstation override on macOS and the general fallback elsewhere.

These facts establish a WARP enrollment/bootstrap consumer, not continuous runtime use and not MCP authorization. WARP may provide network reachability or posture signals, but remote MCP endpoints still require their own browser OAuth or service identity, and local MCP boundaries remain unchanged.

The profile/schema should reserve `^CLOUDFLARE_TEAMS_CLIENT_(ID|SECRET)$` from generic `cloudflare` patterns and add an exact `cloudflare-warp-enrollment` capability. During migration only:

| Exact source | Destination | Admission |
| --- | --- | --- |
| workstation Teams pair | dedicated macOS project root | `macos.megabyte.space` enrollment/recovery only |
| general Teams pair | dedicated Ubuntu project root | `ubuntu.megabyte.space` enrollment/recovery only |

Zen, Legion, Omen, managed-workstation, MCP, WordPress, CI, and human profiles receive neither source. The identical ciphertext/equivalence relation is recorded as metadata so planning does not report a conflicting value, but each source retains independent destination, validation, cutover, and retirement evidence. No ambient fallback may route the general pair to another host.

The active token's 2123 expiry and reuse across two host classes are transition debt. Desired state uses one independently revocable WARP enrollment token per host identity (or at minimum per host class), each admitted only to the matching project and WARP Login policy. After each host proves enrollment/re-enrollment and connected health with its replacement, the shared `Desktopbrew` token is removed from policy and revoked through separately authorized credential rotation. Migration is not complete merely because the shared token is valid today.

Retrieval is bounded to enrollment/recovery. The resolver passes the pair request-locally to the platform-supported WARP enrollment operation and must not render it into a persistent readable MDM file, shell environment, logs, argv, generated client, or MCP descriptor. Existing healthy registration should not fetch the pair on every boot. Recovery tests must prove a missing/revoked token fails closed without disconnecting a healthy registered client.

### Cloudflare Origin CA key disposition

Repo-wide evidence finds no executable consumer of `CLOUDFLARE_ORIGIN_CA_KEY`; documentation explicitly calls it currently unused, while a live read-only Origin CA certificate-list call proves the exact legacy User Service Key remains valid. Deleting a valid account-level certificate-issuance credential without first preserving it would violate the estate migration objective. Both general and workstation copies therefore route to the dedicated `cloudflare-control-plane.megabyte.space` Infisical project, which has human-admin access only and no runtime machine identity.

The project exposes an exact `cloudflare-origin-ca-admin` capability and never grants the key through generic `cloudflare`, macOS, Ubuntu, managed-host, MCP, WordPress, CI, or application profiles. The two byte-identical sources retain separate validation and retirement records but converge on one destination value. After destination round trip and human-admin retrieval verification, both encrypted sources may retire. Any future certificate-issuance automation requires a newly scoped API token and dedicated audited workload identity rather than access to this legacy key.

### Megabyte OS E2E Access credential placement

Provider metadata identifies the general-store `CF_ACCESS_CLIENT_ID` pair as the active service token `megabyte-os-e2e`, expiring 2027-09-29, authorized by exactly one policy on the `Megabyte OS` Access application for `os.megabyte.space`. Local `megabyte.space` verification scripts consume the generic environment names for authenticated E2E calls. Mission/Listmonk, GitLab gatekeeper, project-sites, and other repositories use the same generic variable names for different application-specific tokens; name compatibility is not authorization compatibility.

The source pair is admitted only through an exact `megabyte-os-e2e-access` capability on `macos.megabyte.space`, because the evidenced runner is the local macOS verification controller. It routes to the dedicated macOS project root and is excluded from Ubuntu, Zen, Legion, Omen, MCP/portal credentials, every Worker binding, Mission/Listmonk, GitLab, project-sites, and generic `cloudflare` capability matching. `MCP_AUTOMATION_CF_ACCESS_CLIENT_*` and Secrets Store bindings remain distinct credentials and namespaces.

The resolver must bind metadata `{token: megabyte-os-e2e, application: Megabyte OS, domain: os.megabyte.space, runner: macos.megabyte.space}` and inject the pair request-locally only into the exact verification command. A consumer declaring only `CF_ACCESS_CLIENT_ID/SECRET` without matching application provenance cannot select it. No temporary file fallback, repository `.dev.vars`, Worker secret, log, argv, browser artifact, or generated MCP configuration may receive the values.

The token's active metadata and policy membership prove identity/configuration, but `os.megabyte.space` currently returns origin `522`; therefore a real allowed call has not proven end-to-end usability. Its validation ledger remains `unverified` or `blocked-upstream` rather than `valid`, and the hard pre-write/apply and cutover gates remain closed. After origin recovery, acceptance requires an authenticated allowed E2E call, an anonymous denial, and explicit denial/non-authorization at representative Mission/Listmonk and unrelated Access applications without exposing response secrets.

### Acceptance scenarios

1. **macOS default inventory:** selecting only `macos.megabyte.space` uses its declared `secrets-workstation` overrides plus the allowed general fallback and records both sources without values.
2. **Ubuntu default inventory:** selecting Ubuntu ignores `secrets-workstation`, even when that directory exists and contains a colliding name, and plans from the general inventory only.
3. **Other-host default inventory:** an undeclared or non-macOS host cannot inherit workstation overrides.
4. **Explicit directory override:** `--secret-directory` affects exactly one selected host and one plan, is visible in the plan digest, and does not persist or widen the allowlist.
5. **Unsafe override:** multi-host, missing, unapproved, ambiguous, or symlink-escaping directory overrides fail before decryption or external mutation.
6. **AI upstream isolation:** Ubuntu/LiteLLM can resolve its allowlisted raw provider key; macOS receives `403` or no grant for that key.
7. **LiteLLM client access:** macOS can resolve only its scoped LiteLLM client key and use the gateway without receiving an upstream provider key.
8. **macOS SSH controller:** the macOS plan admits exactly the four reviewed Coolify/Ubuntu Access SSH client names and its proxy retrieves the matching pair without logging it.
9. **Destination-host denial:** Ubuntu, Zen, Legion, and a declared Omen profile exclude all `CF_ACCESS_SSH_*_(CLIENT_ID|CLIENT_SECRET)` names despite their generic Cloudflare capability.
10. **Undeclared Omen:** selecting Omen before an explicit project/path/identity declaration fails before source validation or retrieval.
11. **New SSH caller:** a new runner cannot reuse the macOS pair through a broad profile and instead requires its own workload identity and token contract.
12. **WARP enrollment transition:** macOS maps the workstation Teams source to its dedicated project and Ubuntu maps the general source to its dedicated project; both retrieve only for bounded enrollment/recovery.
13. **Other-host WARP denial:** Zen, Legion, Omen, MCP, WordPress, and generic managed-workstation plans exclude both Teams sources despite broad Cloudflare matching.
14. **Healthy registered client:** a connected macOS or Ubuntu client does not require token retrieval on every boot, and absence of a readable MDM token file is not treated as enrollment failure.
15. **Shared-token replacement:** independent replacement tokens are proven per host before `Desktopbrew` policy removal/revocation; one host's success cannot authorize the other's cutover.
16. **Origin CA key unused:** both exact Origin CA sources have empty destinations and remain retirement-candidate until no-consumer and provider-status evidence permits exact-source retirement.
17. **Origin CA consumer discovered:** migration blocks and requires a dedicated certificate-issuance workload design; no host or generic Cloudflare profile receives the legacy key.
18. **Megabyte OS E2E routing:** only the macOS plan admits the exact OS E2E pair and injects it into the provenance-bound verification process.
19. **Generic-name collision:** Mission/Listmonk, Workers, MCP automation, GitLab, and project-sites cannot select the OS token merely because they declare `CF_ACCESS_CLIENT_ID/SECRET`.
20. **Origin unavailable:** active token metadata plus an `os.megabyte.space` `522` remains blocked/unverified and cannot satisfy provider validation, apply, or cutover.

## Hardened host profiles

A profile is a versioned allowlist contract, not a convenience bundle. Selection is bound to a stable enrolled host identity and asserted role; hostname alone is insufficient. The effective grant is the intersection of profile capability groups, platform and environment constraints, observed consumer demand, identity-specific approved additions, and explicit denials.

macOS developer workstations may receive broader development capabilities than servers, but not recovery roots, personal credentials, unrelated production administration, signing roots, or destructive infrastructure credentials by default. Ubuntu runner/server profiles receive service-specific non-interactive grants and no developer-personal bundle. Unknown, renamed, cloned, stale, or role-conflicting hosts receive no operational secrets.

Profiles have an owner, schema version, review/expiry timestamp, maximum grant size, permitted environments, and revocation/downgrade behavior. Expansion produces a reviewable diff and never occurs implicitly from a repository scan. Host identities are independently revocable and cannot impersonate GitHub OIDC workloads.

### Free-plan project isolation

Host-class isolation is enforced with separate Infisical projects: one for the macOS host profile and one for the Ubuntu host profile. Each machine identity has **No Access** at the organization level and **Viewer** only in its assigned host project. Secrets are stored at that project's root secret path; separation does not depend on paid path-scoped roles.

The macOS identity cannot enumerate or read the Ubuntu project, and the Ubuntu identity cannot enumerate or read the macOS project. Cross-project reads must return `403`; a missing secret or empty result is not sufficient denial evidence. Project IDs and identity IDs may appear in value-free receipts, but credentials and secret values may not.

### Host-declared project and path routing

Every host entry in desired state declares an exact `projectId` and `secretPath`. The pair is atomic routing authority: authentication, reads, verification, migration planning, and rollback must use both values from the selected host declaration. A valid identity with an absent, mismatched, or undeclared pair fails closed before secret resolution.

Dedicated macOS and Ubuntu hosts use their respective isolated host project with `secretPath: /`. Legacy managed workstations that have not completed project isolation may temporarily declare the existing Global project plus their exact host-scoped path. This compatibility route is explicit, host-by-host, observable, and retirement-tracked; it does not permit another host, an unknown hostname, or a new enrollment to inherit Global access.

The CLI `--project-id` option is a single-host operational override only. It may replace the declared project for the one explicitly selected host during a reviewed migration or recovery action, but it does not change other hosts, does not persist desired state, does not select a secret path, and cannot make an undeclared host eligible. The host declaration's `secretPath` remains mandatory unless an equally explicit single-host path override is separately supported and plan-bound.

Ambient project selection is prohibited. The reconciler and runtime resolver must not read project authority from the current working directory, `.infisical.json`, home-directory configuration, a repository-local default, or an Infisical CLI remembered project. They pass the declared project ID and path explicitly on every operation and verify the returned project context before accepting a result.

### Workload target model

Workloads are a separate target class from hosts. The manifest entry `workloads.mcp.megabyte.space` declares Infisical project ID `4ae065b0-c081-454e-a513-220a28e5d2f0` and `secretPath: /`. Its identity, capability groups, source policy, validator policy, destinations, consumers, and retirement state are workload-scoped and cannot be inherited from a host profile.

CLI selection is exclusive: exactly one of `--host <id>` or `--workload <id>` may be supplied for a targeted plan/apply. Supplying both, neither where an explicit target is required, multiple targets, an unknown target, or using a host override with a workload fails before inventory resolution. `--project-id` and any secret-directory override remain single-target overrides and cannot change the target class.

Workload discovery uses exactly one manifest-declared source store. Ordinary and MCP workloads use the general encrypted inventory; declared WordPress/site workloads use `secrets-wordpress`. No workload may merge source stores or consult `secrets-workstation`, even when run on macOS or from a workstation checkout. Repository location, executing machine, cwd, home configuration, and host identity do not alter workload source selection.

### WordPress/site workload destination

The 14 current `secrets-wordpress` sources form a separate legacy source store, not a host overlay and not part of the general workload inventory. The manifest should add `workloads.wordpress-platform.megabyte.space` with:

- `profile: wordpress-platform`;
- a newly provisioned, dedicated Infisical project ID recorded explicitly as `projectId` (never the Global, macOS, Ubuntu/LiteLLM, MCP, or a host project);
- `secretPath: /` because free-plan isolation is enforced at the project boundary rather than relying on path-scoped roles;
- `sourceStore: secrets-wordpress` as an exclusive source policy, with no merge from general or `secrets-workstation`;
- a dedicated non-human identity with organization **No Access** and **Viewer** only in that project; and
- an exact per-source allowlist derived from evidenced consumers, validators, destinations, and retirement state.

The project ID must be obtained from reviewed project creation/import and then committed as non-secret metadata; architecture must not invent a placeholder UUID or reuse an existing project for convenience. `--workload wordpress-platform.megabyte.space` is the only selector that may initially inspect these source identities, and it remains mutually exclusive with `--host` and every other workload.

The observed source names divide into review groups, not automatic grants:

| Review group | Sources | Admission condition |
| --- | --- | --- |
| object storage and backup | `CLOUDFLARE_R2_ID`, `CLOUDFLARE_R2_SECRET`, `CLOUDFLARE_R2_TOKEN`, `RESTIC_PASSWORD`, `RESTIC_SYSTEM_PASSWORD` | exact backup/runtime consumer and provider validation; retain a restic source only when a technically required offline-recovery exception remains |
| ingress and private networking | `CLOUDFLARED_DOCKER_SWARM_TOKEN`, `TAILSCALE_AUTH_KEY` | exact platform bootstrap/runtime consumer; no application-site or host-default grant |
| observability | `NETDATA_ROOM`, `NETDATA_TOKEN`, `NGINX_AMPLIFY_API_KEY` | exact monitoring agent consumer and bounded provider validation |
| outbound mail | `SENDGRID_API_KEY` | exact WordPress/site mail consumer and provider-scoped validation |
| SFTPGo bootstrap administration | `SFTPGO_DEFAULT_ADMIN_USERNAME`, `SFTPGO_DEFAULT_ADMIN_PASSWORD` | bootstrap-only consumer, bounded delivery, and removal from steady-state runtime after initialization where supported |
| privileged bootstrap | `SUDO_PASSWORD` | blocked by default; admit only to a separately justified bootstrap/recovery workload, never the WordPress application runtime |

The table is classification evidence only. It does not establish that one identity needs every source. If backup, observability, mail, SFTP/bootstrap, or an individual site runs under a different identity or failure boundary, its sources must move to a separate explicit workload target and dedicated project. Secret paths within one project are organizational and do not substitute for identity isolation. Site-specific credentials belong in `workloads.wordpress-site.<site-id>` (or an equivalently stable site workload ID) with its own project and identity; they must not accumulate in the shared platform project.

Planning fails when a WordPress source lacks an evidenced consumer, when more than one target is plausible but undeclared, or when a requested target would receive a source outside its exact allowlist. Cross-target acceptance requires the intended workload identity to retrieve its destination and the macOS, Ubuntu/LiteLLM, MCP, Global/legacy-host, and unrelated site identities to receive explicit denial. A host that happens to run WordPress receives no access through its host profile; the workload identity obtains secrets independently at runtime.

### MCP workload credential placement

Cloudflare-native provider credentials required by the MCP portal/control-plane runtime are classified for `workloads.mcp.megabyte.space` and routed only to project `4ae065b0-c081-454e-a513-220a28e5d2f0` at `/`. They are not host credentials and must not appear in macOS, Ubuntu/LiteLLM, legacy Global workstation, CI, or human profiles unless a separate consumer contract explicitly defines a different credential.

The MCP workload may receive only credentials evidenced by its Cloudflare-native consumers. This placement does not grant a host access merely because that host administers, deploys, or tests the workload. Cross-target reads must fail with `403` where authorization is evaluated.

### Universal Auth lifecycle and local credential storage

Host identities authenticate through Infisical Universal Auth. Access tokens have a 900-second lifetime and a maximum of two uses. Universal Auth client secrets have a 90-day lifetime and require an owner, expiry observation, renewal procedure, overlap-safe replacement, and revocation path.

The macOS client secret is stored in the logged-in user's macOS Keychain with access limited to the intended resolver. The Ubuntu client secret is stored in a root- or service-owned mode-`0600` file outside the repository and rendered configuration. Neither credential may be placed in chezmoi source, shell profiles, argv, logs, telemetry, Markdown, or Infisical project secrets.

## Migration state machine

Each secret progresses independently through `inventoried`, `planned`, `written`, `verified`, `consumer-cutover`, `fallback-bounded`, `retirement-eligible`, and `source-retired`. Each transition binds to the reviewed plan and records value-free evidence. Every in-scope source advances to `source-retired` and is deleted when its exact validation, complete required-destination round trips and target retrieval, consumer cutover, observation, recovery, offline-exception, and retirement-assertion gates pass. A canary proves the mechanism but grants no authority over another source. Credential rotation/revocation and age-key or age-identity retirement remain separate actions.

## Safe apply

Apply requires a complete deterministic plan, exact source/destination binding, authenticated least-privilege writer identity, concurrency lock, and explicit admission of each secret name. It decrypts one selected value at a time, streams it directly to the Infisical write operation, clears references after the bounded operation, and never stages plaintext on disk or places values in argv, logs, receipts, shell history, telemetry, or Markdown.

Existing destination values are not overwritten blindly. The reconciler reports a value-free conflict and requires an explicit overwrite decision bound to the plan digest. Failure leaves the encrypted source and current runtime path unchanged.

### Durable metadata-only validation ledger

Credential validity is recorded in a durable value-free ledger separate from secret material. Each record binds a canonical credential name, source inventory reference, intended owner/consumer, classification, validator identity and version, validation method, validation scope/environment, status, observed time, expiry or freshness deadline, and evidence reference. It must not contain the credential value, reversible encoding, response body, authorization header, value hash/fingerprint, or enough low-entropy metadata to reconstruct or test the secret offline.

Allowed admission status is exactly `valid`. `invalid-retired` records document credentials proven invalid and intentionally excluded from migration; they are evidence for retirement classification, never apply authority. Missing, `unverified`, `invalid-retired`, expired, stale, scope-mismatched, validator-unknown, or provenance-incomplete records fail admission.

Validator provenance is allowlisted and purpose-specific. A syntax check cannot validate live authorization; a provider validation cannot be reused for another environment or credential class. The plan binds the exact ledger record and evidence digest so status cannot change between review and apply without invalidating the plan.

Validation is source-specific. Every selected source identity must have current provider-specific evidence that tests the minimum safe capability required by its intended consumer without exposing the value or performing a destructive action. Shared canonical names do not share validation automatically. Provider-unreachable, missing, stale, scope-mismatched, rate-limited-without-conclusion, or syntactically plausible credentials remain `unverified` and cannot be used.

Provider-confirmed invalid credentials may become `invalid-retired` only when provenance proves the exact source identity is invalid, target/consumer listings show no required valid destination or runtime dependency, the source is not an offline exception, and a reviewed retirement assertion exists. `invalid-retired` never authorizes migration, runtime use, or fallback.

### Hard pre-write apply gate

Before decrypting any selected source or issuing any external write, apply validates the complete selected set. Every credential must have a current `valid` ledger record whose canonical name, source reference, destination, owner/consumer, environment, validator method, and plan binding match. Admission is all-or-nothing: one rejected record aborts the entire apply before the first write. Apply does not partially migrate the remaining valid subset unless a new reduced plan is explicitly generated and reviewed.

The gate runs again immediately before mutation under the apply lock. Ledger changes, freshness expiry, destination drift, or selection changes invalidate the plan and require re-planning. Validation does not authorize overwrite, permission widening, deletion, rotation, or source retirement.

Workload targets pass through the identical ledger gate. Every workload-selected credential requires a fresh matching `valid` record whose provenance binds the workload ID, general-inventory source, project ID, root path, consumer, environment, validator, and plan. A host validation record cannot admit a workload credential, and a workload validation record cannot admit a host credential.

### Migration and source-retirement evidence

A successful write records value-free migrated-destination evidence: canonical credential name, destination project/environment/path, destination metadata/version identifier where safely available, writer identity, plan digest, timestamp, and post-write authorized-read/unauthorized-denial result. It records no value or value fingerprint.

Workload migration additionally requires a round-trip gate: after write, the workload identity resolves the exact destination through the production-equivalent access path, the intended Cloudflare-native consumer can use it in a bounded non-destructive check, and representative host/cross-project identities are denied. Failure rolls back or leaves the source authoritative and prevents cutover/retirement evidence.

A source-retirement assertion binds the exact encrypted source path/name, canonical credential, completed migration evidence, consumer cutover evidence, validation record, observation window, rollback/recovery state, approving change, and retirement timestamp. The assertion must distinguish `retirement-eligible`, `source-retired`, and `invalid-retired`. It is rejected if the destination evidence is absent, mismatched, stale, or does not prove the intended consumer boundary. A canary assertion grants no authority over another source.

Every source has an explicit required-destination set derived from least-privilege host/workload mappings. Each destination is independently complete only after exact-project/path write, Infisical read-after-write round trip, authorized retrieval by the intended target host/workload identity, representative cross-target denial, real consumer cutover, and rollback evidence. A successful writer-side round trip alone is insufficient.

Encrypted-source deletion is a final, exact-source mutation. It is admitted only when all required destinations are complete, profile/listing synchronization is current, the source is not needed by an offline exception or fallback window, the observation period has elapsed, rollback/recovery evidence exists, and the reviewed retirement assertion binds the current ciphertext drift digest. If any destination or consumer is incomplete, the source remains encrypted in place.

For `invalid-retired`, the required-destination set must be explicitly empty and provider-invalid evidence plus consumer/profile/listing absence replaces migration round-trip evidence. Deletion still requires an exact reviewed assertion and must not delete a same-named source from another store.

### Offline exception handling

Offline exceptions are first-class source mappings, not a generic exemption from inventory. Each exception binds exact source identity, owner, offline consumer, technically required reason, minimum recovery capability, permitted hosts, review expiry, and executed recovery evidence. An exception source is excluded from deletion only while the exception remains current, technically necessary, minimum-scope, and not replaceable by the validated recovery destination. Convenience, stale, or superseded exceptions do not justify preservation.

Online consumers must not use offline exceptions as ambient fallback. Migration plans report exceptions separately, test independent recovery without logging values, and require a reviewed replacement or exception retirement before encrypted-source deletion.

### Profile and listing synchronization

The value-free inventory listing, profile capability groups, host/workload declarations, source mappings, validation ledger, destination matrix, and retirement ledger form one closed set. Planning fails when a listed source lacks disposition/mapping, a profile references an unlisted source, a validation record references a missing source ID, a destination is absent from its target declaration, or a retired/deleted source remains selectable.

Listing/profile synchronization is deterministic and drift-detecting. Additions default to `blocked-unknown`; removals require a retirement/deletion assertion; precedence and alias changes invalidate prior plans. The operator-facing list command reports source IDs, stores, names, dispositions, targets, validation status, destination completion, offline-exception state, and blockers without resolving values.

### Validation-ledger acceptance scenarios

1. **Complete valid selection:** every selected credential has fresh matching `valid` provenance; preflight may proceed to the separately authorized write phase.
2. **One missing record:** a batch containing one credential without a ledger record aborts before decryption and writes nothing.
3. **Unverified record:** `unverified` is rejected even when the source and destination exist.
4. **Invalid retired record:** `invalid-retired` is excluded and cannot be revived by apply or a directory/project override.
5. **Stale or wrong-scope provenance:** expired evidence or validation against another environment/provider/consumer aborts the whole plan.
6. **Ledger race:** a record changed after plan review invalidates the plan at the locked pre-write gate.
7. **Destination evidence:** a completed migration produces metadata-only destination and positive/negative access evidence without value fingerprints.
8. **Retirement assertion:** only the exact source with matching migration, cutover, validation, observation, and recovery evidence may be asserted retired.
9. **Same name in three stores:** general, workstation, and WordPress entries receive distinct source IDs and independent validation/destination/retirement state.
10. **Incomplete destination set:** one target passes round trip while another lacks target-host retrieval; the encrypted source remains present.
11. **Provider-invalid source:** exact provider evidence plus empty consumer/destination listings permits `invalid-retired`, but never migration or fallback.
12. **Offline exception technically required:** completed online migration does not permit source deletion while the bound exception is current, minimum-scope, recovery-tested, and still technically necessary; stale, convenience-only, or superseded exceptions must retire.
13. **Listing drift:** an unlisted file, dangling profile reference, stale validation source ID, or selectable retired source blocks planning and apply.
14. **Target retrieval:** writer round trip passes but intended host/workload retrieval fails; destination and cutover remain incomplete.

### Workload-target acceptance scenarios

1. **MCP workload routing:** `--workload mcp.megabyte.space` selects project `4ae065b0-c081-454e-a513-220a28e5d2f0`, root path `/`, and the general inventory only.
2. **Host/workload exclusivity:** supplying `--host` and `--workload` together fails before inventory access, decryption, authentication, or mutation.
3. **Unknown or multiple workload:** an undeclared workload or multi-workload selection fails closed and cannot inherit the executing host's profile.
4. **Workstation inventory exclusion:** MCP workload planning ignores `secrets-workstation` even when a colliding name exists there or execution occurs on macOS.
5. **Ledger target binding:** a credential with a valid host ledger record but no matching MCP workload record is rejected before write.
6. **Cloudflare provider placement:** an approved Cloudflare-native provider credential is planned for the MCP workload and excluded from all host plans.
7. **Round trip:** after migration, the MCP workload identity retrieves and exercises the exact credential through the production-equivalent Cloudflare-native path without exposing its value.
8. **Cross-target denial:** macOS, Ubuntu/LiteLLM, and legacy workstation identities receive `403` for the MCP workload credential and destination.
9. **WordPress source isolation:** `--host` and non-WordPress workloads cannot select any `secrets-wordpress` source; the declared WordPress workload sees only its exact reviewed source IDs.
10. **Dedicated WordPress project:** the WordPress workload resolves its explicit project/root pair while host, MCP, Global, and unrelated site identities receive explicit denial.
11. **Privilege split:** `SUDO_PASSWORD` remains blocked unless a separate bootstrap/recovery workload and consumer contract are approved; it never enters the steady-state WordPress platform allowlist by filename.
12. **Site split:** when a source is required by only one site or consumer identity, planning rejects placement in the shared platform project and requires a dedicated site workload/project.

## Consumer cutover and fallback

`get-secret` and workload launchers prefer the exact Infisical project/environment/path authorized for their identity. During a bounded transition, fallback to age is permitted only when the manifest names that secret and consumer as a migration fallback or offline exception. Ambient fallback to the full chezmoi inventory is prohibited.

Cutover verification covers authorized retrieval, unauthorized denial, consumer startup/use, Infisical outage behavior, expired/revoked identity, replacement-host enrollment, profile downgrade, and rollback to the preserved encrypted source. Evidence records names, paths, identity IDs, statuses, timestamps, and plan digests only.

## GitHub and non-host identities

CI uses repository-and-environment-bound GitHub OIDC with exact claims and secret-name allowlists. Host machine identities, CI identities, release signers, backup/restore identities, and human operators remain separate. No long-lived host credential is copied into GitHub, and no CI identity inherits a host profile.

## Rollout and rollback

Roll out one capability group and one host class at a time: read-only inventory, reviewed plan, writer canary, authorized retrieval from the assigned root path, cross-project `403`, consumer canary, outage/rollback drill, then bounded expansion. macOS developer-workstation and Ubuntu server/runner profiles require independent evidence. The canary proves the retirement mechanism; each subsequent source independently passes the same gates and is then deleted through its own assertion.

Before exact-source deletion, rollback may restore consumer resolution to the still-present encrypted source for the affected allowlisted name. After deletion, rollback and recovery use the validated Infisical destination or the source's still-current technically required offline exception; the design must not claim a deleted source remains available. Revocation or disabling of a new host binding remains separately authorized and leaves unrelated paths and identities untouched.

## Key risks and mitigations

- **Broad workstation grant:** constrain profiles by identity, capability, environment, explicit denials, maximum size, and expiry.
- **Secret disclosure during audit:** inspect names/metadata only; prohibit value fingerprints, rendered targets, environment dumps, and value-bearing logs.
- **Dual authority drift:** record intended runtime authority and bounded fallback state per secret; fail on conflicting sources.
- **Infisical outage locks out recovery:** preserve tested offline exceptions and execute outage/replacement-host drills before retirement eligibility.
- **Overwrite of a newer destination value:** fail closed on value-free conflict unless an exact plan-authorized overwrite is approved.
- **Cloned or renamed host inherits access:** bind grants to enrolled immutable identity, not hostname; deny stale or conflicting identity facts.
- **Free-plan role limits weaken path isolation:** isolate host classes into separate projects, assign organization No Access and project Viewer, and verify cross-project `403`.
- **Ambient CLI state routes a host to the wrong project:** require the host-declared `projectId`/`secretPath` pair on every operation and reject cwd/home/remembered-project inference.
- **Migration override broadens the fleet:** constrain `--project-id` to one explicitly selected host, keep it non-persistent, and retain the declared path and identity checks.
- **Workstation inventory overrides Ubuntu:** bind `secrets-workstation` to `macos.megabyte.space`; make every alternate directory an explicit single-host `--secret-directory` override.
- **Raw provider key reaches a developer laptop:** classify upstream and client keys separately, keep upstream keys in Ubuntu/LiteLLM only, and verify macOS denial.
- **SSH destination receives its caller bearer token:** reserve all Cloudflare Access SSH client names from broad Cloudflare matching and admit only exact names to the evidenced controller capability.
- **Provisioning repository is mistaken for host consumption:** distinguish code that reconciles Access policy IDs from the runtime identity that initiates SSH; repository reference alone never grants a destination host the credential pair.
- **Shared WARP bootstrap becomes a fleet credential:** restrict transition delivery to macOS/Ubuntu enrollment, then replace it with independently revocable host tokens and remove the shared policy member.
- **Rendered MDM configuration persists a bearer secret:** retrieve only for bounded enrollment/recovery and verify no readable installed token file, log, environment, or generated artifact remains.
- **Connected WARP is mistaken for MCP authentication:** treat WARP only as reachability/posture; retain endpoint-specific MCP OAuth/service authentication and local-only boundaries.
- **Unused Origin CA key is broadly migrated by name:** assign empty destinations and retirement-candidate state; if a consumer emerges, require a dedicated issuance workload rather than a host grant.
- **Generic Access variables conflate unrelated service tokens:** require application/domain/runner provenance in addition to the variable name and use exact capabilities per Access application.
- **Control-plane metadata masks a dead origin:** keep OS E2E validation blocked until a real authenticated call passes; never convert `522` into credential success.
- **Long-lived local bootstrap credential leaks:** cap client secrets at 90 days, store them in Keychain or a mode-`0600` Ubuntu file, and use 900-second/max-two-use access tokens.
- **Profile expansion by repository noise:** require explicit capability admission and reviewable diff; discovery alone never grants access.
- **Canary retirement is mistaken for bulk authority:** bind every deletion to its own exact-source assertion and current drift digest; the canary cannot authorize another source, while rotation, revocation, and age-key retirement remain separate work.
- **Stale or fabricated validity admits a bad credential:** require allowlisted validator provenance, freshness, exact scope, evidence binding, and a locked recheck before any write.
- **Batch partially writes before discovering an invalid record:** validate the entire selected set atomically before decryption and mutation; require a new plan for any reduced retry.
- **Validation evidence leaks the credential:** prohibit values, fingerprints, response bodies, and replayable request material from the ledger and migration receipts.
- **Retirement assertion outruns migration evidence:** require exact destination, consumer cutover, denial, observation-window, and recovery bindings per source.
- **Workload inherits operator host access:** separate target classes, make `--workload` mutually exclusive with `--host`, and deny host-profile reuse.
- **Workload execution on macOS selects workstation overrides:** force each workload to its single manifest-declared source store, independent of executing machine or cwd, and prohibit `secrets-workstation` for all workloads.
- **Cloudflare provider credentials spread to hosts:** classify them as MCP-workload-only and test their absence from every host plan plus cross-project `403`.
- **Same-named sources are collapsed:** make store-qualified source identity the unit of validation, migration, and retirement.
- **Writer verification masks target failure:** require both Infisical round trip and intended target-host/workload retrieval before destination completion.
- **Partial multi-destination migration triggers deletion:** require all declared destinations and consumers complete before exact-source retirement.
- **Offline recovery is deleted after online cutover:** bind offline exceptions to exact source IDs and exclude active exceptions from deletion.
- **Profiles and inventory drift apart:** enforce closed-set listing/profile/ledger/destination synchronization before decryption or mutation.
- **WordPress store becomes a hidden host bundle:** make `secrets-wordpress` selectable only by explicit WordPress/site workloads and prove every host/default workload excludes it.
- **Shared WordPress project over-grants independent consumers:** use a dedicated project per identity/failure boundary; treat project paths as organization, not an authorization boundary.
- **Bootstrap administration becomes steady-state application access:** block privileged and SFTP bootstrap sources by default or deliver them through separately justified bounded bootstrap workloads.
