# Tasks

- [x] Add a read-only check for branch admission, required reviewers, and prevention of self-review.
- [ ] Identify the supported update paths for the GitHub environment and Infisical identity settings.
- [ ] Align the Control Plane admission rules with exact main revisions while preserving reviewer and identity isolation.
- [ ] Verify that an approved dry run or release uses the exact requested main SHA and that unauthorized refs and identities fail the gates.
- [ ] Verify the approved deployed revision and production probes through the protected workflow.
