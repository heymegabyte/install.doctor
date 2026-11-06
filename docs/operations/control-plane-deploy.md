# Control-plane production deployment

The production Worker is deployed only by the manual `Deploy control plane to production` workflow
from `master`. The workflow checks out the immutable workflow commit, installs locked dependencies,
runs the complete control-plane tests and Wrangler dry run without credentials, and only then obtains
a short-lived Infisical token through GitHub OIDC.

## One-time authority provisioning

Create the protected GitHub environment `control-plane-production`, restrict it to `master`, and
require an authorized reviewer. Configure the nonsecret repository variables
`INFISICAL_PROJECT_SLUG` and `INFISICAL_CONTROL_PLANE_DEPLOYER_ID`.

Provision the `github-control-plane-deployer` identity exactly as declared in
`config/infisical/bootstrap-release-identities.json`. Its Infisical path is fixed at
`/ci/control-plane/deployer` and contains exactly:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`

The Cloudflare token is restricted to the Install Doctor account and zone, Worker script/custom-domain
deployment, and cache purge. It has no R2 object, D1 mutation, signing, DNS-wide, or unrelated-zone
authority. Verify denial against another account, another zone, every release-secret path, and D1/R2
mutation before approving the identity. Infisical imports, recursion, inherited grants, and caller-
selected paths are forbidden.

## Deploy and verify

Dispatch the workflow from the reviewed `master` commit. It records the prior and deployed Worker
version IDs, deploys with the lockfile Wrangler in strict mode while preserving dashboard variables,
purges only `app.install.doctor`, clears the three injected variables, and then performs public
credential-free verification.

Healthy public state is deliberately one of two outcomes:

- HTTP 200: `/start` is a syntactically valid immutable signed launcher with no mutable GitHub URL.
- HTTP 503: the exact fail-closed release channel/trust response is returned before first activation
  or during a release outage.

The workflow also requires `/health` to report `status=ok` and an unknown immutable release to return
the exact `release_not_found` 404. A running Worker alone is not deployment proof. Preserve the
secret-free 90-day deployment receipt artifact.

## Rollback

Configuration rollback is explicit and does not roll back D1 data or release objects. From an
authorized protected session, inspect the deployment receipt and run from `packages/control-plane`:

```bash
./node_modules/.bin/wrangler rollback PREVIOUS_VERSION_ID
```

Purge only `app.install.doctor` and repeat the same public checks. Never auto-rollback a deployment
whose live data compatibility has not been assessed, and never treat rollback as release-channel
activation or storage recovery.
