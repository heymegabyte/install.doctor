# Tasks

- [x] Add a read-only check for branch admission, required reviewers, and prevention of self-review.
- [ ] Identify the supported update paths for the GitHub environment and Infisical identity settings.
- [ ] Align the Control Plane admission rules with exact main revisions while preserving reviewer and identity isolation.
- [ ] Verify that an approved dry run or release uses the exact requested main SHA and that unauthorized refs and identities fail the gates.
- [ ] Verify the approved deployed revision and production probes through the protected workflow.

Live follow-up confirmed that GitHub still admits only `master` and requires independent review. Repository, environment, and repository-visible organization Actions variable listings returned none of the three required Infisical workflow variables. The authenticated Infisical profile could read organization project and identity metadata and did not expose the production project or either declared workload identity. Identity visibility was incomplete, so this does not establish that the identities are absent. GitHub lists no prior production workflow runs.
