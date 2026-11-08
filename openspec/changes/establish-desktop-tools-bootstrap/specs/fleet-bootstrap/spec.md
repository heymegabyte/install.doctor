# Spec Delta

## MODIFIED Requirements

### Requirement: Safe curl-pipe entrypoint
The root of a valid Desktop Tools profile subdomain SHALL stream a bounded stage-zero launcher that downloads the provisioner into a private temporary directory and executes the verified local file, SHALL NOT use process substitution, and SHALL use `/dev/null` as target stdin while cross-device authorization is pending.

#### Scenario: Interactive invocation
- **WHEN** a user runs `curl -fsSL https://example.desktop.tools | bash`
- **THEN** the launcher resolves the `example` profile, verifies the release, and starts headless-capable device authorization

#### Scenario: Headless invocation
- **WHEN** no terminal or graphical session is available
- **THEN** the launcher remains operable through another device's approval and supplies `/dev/null` to unattended subprocesses

#### Scenario: Direct interactive terminal
- **WHEN** an operator explicitly selects a supported local interactive recovery action
- **THEN** only that action may reconnect input to `/dev/tty` after the script stream has been fully separated from command input

### Requirement: Bounded execution
Independent installer tasks SHALL start only through a bounded worker queue. Package-manager and privileged mutations SHALL be serialized per shared lock domain, model-generated text SHALL NOT create execution authority, and any task failure SHALL produce a non-zero result.

#### Scenario: Concurrent install
- **WHEN** more tasks are ready than the configured worker limit
- **THEN** no more than the configured number start and failures are reported

#### Scenario: Agent requests unauthorized effect
- **WHEN** the provisioning agent requests an effect outside the approved typed task graph
- **THEN** the effect is rejected without mutation

### Requirement: Plan before mutation
Interactive and headless runs SHALL resolve the profile revision, role, capabilities, network actions, secrets references, consents, permissions, and concurrency into a durable plan before applying system changes.

#### Scenario: Headless plan
- **WHEN** a Desktop Tools profile selects a headless role and capabilities
- **THEN** a versioned plan bound to the profile, release, machine identity, prompt, and tool versions is persisted before approval or mutation

#### Scenario: Profile changes during approval
- **WHEN** the selected profile changes after the target plan was created
- **THEN** the stale plan cannot be applied and the target must present a new diff for approval
