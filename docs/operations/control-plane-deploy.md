# Control-plane production deployment

The production Worker is deployed only by the manual `Deploy control plane to production` workflow
from `master`. The workflow checks out the immutable workflow commit, installs locked dependencies,
runs the complete control-plane tests and Wrangler dry run without credentials, and only then obtains
short-lived, non-overlapping migration and deployment credentials through GitHub OIDC. The migration
job must finish before Worker deployment starts.

The Worker owns the `app.install.doctor` custom domain and the exact `install.doctor/start` zone route.
The latter runs in front of the existing site origin, so the canonical curl entrypoint does not depend
on the legacy Firebase deploy credential and no unrelated site path is intercepted.

## One-time authority provisioning

Create the protected GitHub environment `control-plane-production`, restrict it to `master`, and
require an authorized reviewer. Configure the nonsecret repository variables
`INFISICAL_PROJECT_SLUG`, `INFISICAL_CONTROL_PLANE_MIGRATOR_ID`, and
`INFISICAL_CONTROL_PLANE_DEPLOYER_ID`.

Provision `github-control-plane-migrator` at `/ci/control-plane/migrator` with exactly
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Its Cloudflare token can inspect and migrate only
the production `aid-control-plane` D1 database. It cannot deploy Workers, purge cache, mutate DNS or
R2, or access signing material. The workflow captures a D1 Time Travel bookmark before applying the
reviewed repository migrations and proves the remote pending list is empty afterward.

Provision the `github-control-plane-deployer` identity exactly as declared in
`config/infisical/bootstrap-release-identities.json`. Its Infisical path is fixed at
`/ci/control-plane/deployer` and contains exactly:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`

The deploy Cloudflare token is restricted to the Install Doctor account and zone, Worker script/custom-domain
deployment, and cache purge. It has no R2 object, D1 mutation, signing, DNS-wide, or unrelated-zone
authority. Verify denial against another account, another zone, every release-secret path, and D1/R2
mutation before approving the identity. Infisical imports, recursion, inherited grants, and caller-
selected paths are forbidden.

## Deploy and verify

Dispatch the workflow from the reviewed `master` commit. The migration and deploy jobs each rerun the
tests before receiving their own credentials; those credentials never coexist in one job. Existing
migrations are additive so the old Worker remains compatible during the migration-before-deploy
window. It records the prior and deployed Worker
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

Configuration rollback is explicit and does not roll back D1 data or release objects. D1 Time Travel
restore is destructive and must never be an automatic deployment response. If a migration is implicated,
stop writes, preserve evidence, assess all writes after the recorded bookmark, and use the documented
Cloudflare Time Travel restore procedure only from a separately authorized maintenance session.
From an
authorized protected session, inspect the deployment receipt and run from `packages/control-plane`:

```bash
./node_modules/.bin/wrangler rollback PREVIOUS_VERSION_ID
```

Purge only `app.install.doctor` and repeat the same public checks. Never auto-rollback a deployment
whose live data compatibility has not been assessed, and never treat rollback as release-channel
activation or storage recovery.
