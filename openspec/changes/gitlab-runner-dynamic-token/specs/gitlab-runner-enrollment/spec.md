# Spec: GitLab Runner Enrollment (`gitlab-runner-enrollment`)

## ADDED Requirements

### Requirement: Self-Acquired Runner Authentication Token

The `gitlab-runner` provisioning path MUST obtain its own runner authentication token at enroll time and MUST NOT require a pre-minted registration token anywhere in the environment or secret store.

#### Scenario: Operator enables enrollment with only an access token

- **WHEN** `INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1` and a valid `GITLAB_ACCESS_TOKEN` with the `create_runner` grant are available, `gitlab-runner` is installed, and no `GITLAB_RUNNER_TOKEN_*` variable is set
- **THEN** the hook mints a token from `POST {GITLAB_URL}/api/v4/user/runners` with `runner_type` derived from `GITLAB_RUNNER_SCOPE`, registers it non-interactively, verifies the runner, and exits `0`

#### Scenario: Legacy pre-minted token family stays supported but unnecessary

- **WHEN** a host still exports `GITLAB_RUNNER_TOKEN_LINUX` from `home/dot_config/shell/private_private.sh.tmpl`
- **THEN** the dynamic path ignores it and enrolls from `GITLAB_ACCESS_TOKEN`, and the legacy variable remains documented as compatibility rather than removed

### Requirement: Inert Unless Explicitly Enabled

Enrollment MUST be an operator decision: the hook MUST skip cleanly (exit `0`) when the platform does not apply, when the `gitlab-runner` binary is absent, or when `INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL` is not `1`.

#### Scenario: Package installed without opting in

- **WHEN** the hook runs because `gitlab-runner` happened to be installed and `INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL` is unset
- **THEN** the hook reports lazy enrollment on stderr, makes no network call, writes no config, and exits `0`

#### Scenario: Unsupported platform

- **WHEN** the hook runs on a platform other than Linux or Darwin
- **THEN** it reports inapplicability and exits `0` without invoking `curl` or `gitlab-runner`

### Requirement: Fail Closed Before Any Network Call

The hook MUST validate configuration and credentials before contacting the GitLab API, and MUST use a distinct, stable exit code per failure class so provisioning logs identify the cause without echoing secrets.

#### Scenario: Missing access token

- **WHEN** no `GITLAB_ACCESS_TOKEN` resolves from the environment, `get-secret`, or the age-encrypted chezmoi secret
- **THEN** the hook exits `20` and issues no HTTP request

#### Scenario: Invalid scope or scope identifier

- **WHEN** `GITLAB_RUNNER_SCOPE` is not one of `instance`, `group`, or `project`, or the required numeric `GITLAB_RUNNER_GROUP_ID` / `GITLAB_RUNNER_PROJECT_ID` is missing or non-numeric
- **THEN** the hook exits `2` and issues no HTTP request

#### Scenario: Provider rejects the mint

- **WHEN** GitLab responds with a non-2xx status (for example the token lacks `create_runner` for the requested scope)
- **THEN** the hook exits `21`, leaves any existing runner config untouched, and logs the failing endpoint without printing the access token

### Requirement: Secret Containment

The hook MUST keep both the access token and the minted runner token out of `argv`, the process table, stdout, stderr, and provisioning logs, and MUST keep the runner config private to the owning user.

#### Scenario: Access token transport

- **WHEN** the hook calls the GitLab API
- **THEN** the access token is written once to a `0600` header file inside a `mktemp` directory and passed as `--header @file`, never as an inline `curl` argument

#### Scenario: Minted token handling

- **WHEN** the mint succeeds and `gitlab-runner register` runs
- **THEN** the minted token reaches the trusted binary as a single `argv` element, `register`/`verify` output is captured to a temp file rather than the log, and no output line contains the token

#### Scenario: Config permissions

- **WHEN** the hook writes the runner config
- **THEN** the config directory is `0700`, the config file is `0600`, and the temp directory plus cleared token variables are removed by a trap on `EXIT`, `HUP`, `INT`, and `TERM`

### Requirement: Idempotent Enrollment by Runner Name

The hook MUST NOT re-mint or re-register a runner whose configured name already exists, so repeated provisioning is safe.

#### Scenario: Second provisioning run

- **WHEN** the runner config already contains `name = "<resolved runner name>"`
- **THEN** the hook reports the existing registration, makes no HTTP request, does not invoke `gitlab-runner`, and exits `0`

### Requirement: Offline Contract Gate

The enrollment contract MUST be verifiable without network access or a GitLab instance, and the gate MUST run in the automatically discovered `scripts/test-*.sh` suite.

#### Scenario: Contributor runs the suite

- **WHEN** `bash scripts/test-gitlab-runner-post-hook.sh` (or `scripts/test-all.sh`) runs on a workstation with no GitLab credentials
- **THEN** every assertion passes using stub `curl` and `gitlab-runner` binaries, covering the gates, the mint request shape, token non-disclosure, config permissions, and idempotency
