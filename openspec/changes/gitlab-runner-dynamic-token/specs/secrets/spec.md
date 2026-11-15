# Spec: Secrets (`secrets`)

## ADDED Requirements

### Requirement: Enrollment Credential Documented, Not Pre-Minted

The secret reference MUST document `GITLAB_ACCESS_TOKEN` as the supported GitLab Runner enrollment credential, with the minimum grant required, and MUST mark the `GITLAB_RUNNER_TOKEN_*` family as legacy rather than deleting it.

#### Scenario: Operator looks up the enrollment credential

- **WHEN** an operator reads `docs/customization/secrets.md`
- **THEN** `GITLAB_ACCESS_TOKEN` is listed with its `create_runner` grant (plus `api` for group or project scope), the opt-in variable that enables enrollment, and a link to the software configuration reference

#### Scenario: Existing host still exports a pre-minted runner token

- **WHEN** a host exports `GITLAB_RUNNER_TOKEN_DARWIN`, `_LINUX`, or `_WINDOWS`
- **THEN** the documentation labels each as legacy and superseded by `GITLAB_ACCESS_TOKEN`, and nothing removes or rejects the variable

### Requirement: Secret Resolution Precedence

Enrollment credentials MUST resolve in a fixed, documented order — process environment, then `get-secret`, then the age-encrypted chezmoi secret — so a host can be provisioned from any of the estate's supported secret channels.

#### Scenario: Credential supplied by any supported channel

- **WHEN** `GITLAB_ACCESS_TOKEN` is exported in the environment, or resolvable via `get-secret`, or present as an age-encrypted chezmoi secret
- **THEN** the hook resolves it without prompting and without writing the value to disk outside a `0600` temp header file

#### Scenario: No channel yields a credential

- **WHEN** none of the three channels provides a value
- **THEN** the hook refuses to enroll (exit `20`) instead of registering an unauthenticated or partially configured runner
