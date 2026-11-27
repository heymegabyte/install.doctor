# Tasks

- [x] Add a read-only check for branch admission, required reviewers, and prevention of self-review.
- [ ] Identify the supported update paths for the GitHub environment and Infisical identity settings.
- [ ] Align the Control Plane admission rules with exact main revisions while preserving reviewer and identity isolation.
- [ ] Verify that an approved dry run or release uses the exact requested main SHA and that unauthorized refs and identities fail the gates.
- [ ] Verify the approved deployed revision and production probes through the protected workflow.

Live follow-up confirmed that GitHub still admits only `master` and requires independent review. Repository, environment, and repository-visible organization Actions variable listings returned none of the three required Infisical workflow variables. The authenticated Infisical profile could read organization project and identity metadata and did not expose the production project or either declared workload identity. Identity visibility was incomplete, so this does not establish that the identities are absent. GitHub lists no prior production workflow runs.

## Exact candidate admission recheck

On 2026-11-27 at 06:12 UTC, GitHub reported default branch `master` at `c545678ef4c7801715cb4518b0f52553a5aa3020` and `main` at `42d4edefdaa3a70d916199a9c244ebec8ce0e909`. The candidate is `07ba55883b13df6c82b51aea6552ef420d3bc370` with tree `5cdefc652bfbddc89e72d2ddd8d880c6ad20a7e0`. Its verified package evidence is recorded in [the source lint ratchet](../control-plane-source-lint-ratchet/tasks.md). Neither remote branch contains that commit. Both package subtrees also differ from the verified candidate's subtree. `master` and the candidate are 71 and 277 commits ahead of their common ancestor, respectively, so the candidate cannot be put on the admitted branch by fast-forward.

Both remote branches and the candidate have identical production workflow and identity policy blobs. The active workflow checks out its immutable workflow SHA and admits only `master`. Live environment admission passed for `master` and rejected `main`, and still requires independent review. The checked-in migrator and deployer OIDC claims both restrict the workflow ref to `master`. The production workflow still has no visible runs, and the required variable names remain absent from the repository, production environment, and repository-visible organization variable listings.

Under current admission, a reviewed integration onto `master` would produce a new candidate SHA that requires fresh verification, the workload variables and scopes, and independent approval. Exact `main` admission also requires alignment of the workflow guard, GitHub environment branch policy, and both Infisical OIDC claims. The operations guide allows production publication only through the protected workflow.

The public probes returned `/health` HTTP 200 with `status=ok`, `/start` HTTP 503 with `release_channel_unavailable`, and an unknown release HTTP 404 with `release_not_found`. These are public baseline observations without source-revision evidence. No protected settings or live runtime were changed.
