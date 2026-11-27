# Tasks

- [x] Confirm current baseline and identify the five decode sites.
- [x] Narrow JSON decoding and verify the existing store and signer contracts.
- [x] Verify the Worker build with Wrangler dry run.
- [ ] Deploy the tested revision through the protected production workflow.

The five decode findings are gone. All 171 Control Plane tests passed. Production dispatch requires master and its scoped OIDC identity. The tested main history diverges from master, so the production workflow cannot accept this revision.
