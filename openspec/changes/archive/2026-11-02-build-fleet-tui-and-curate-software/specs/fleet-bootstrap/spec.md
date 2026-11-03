# Fleet bootstrap

## Purpose

Defines the safe, predictable contract for planning and executing cross-platform fleet bootstrap operations.

## ADDED Requirements

### Requirement: Safe curl-pipe entrypoint

The `/start` response SHALL download the provisioner into a private temporary directory and execute the local file, SHALL NOT use process substitution, and SHALL reconnect interactive stdin to `/dev/tty` when available.

#### Scenario: Interactive invocation

- **WHEN** a user runs `curl -fsSL https://app.install.doctor/start | bash` in a terminal
- **THEN** prompts read from the terminal rather than the script stream

#### Scenario: Headless invocation

- **WHEN** no terminal is available
- **THEN** the launcher selects headless mode and supplies `/dev/null` as stdin

### Requirement: Bounded execution

Independent installer tasks SHALL start only through a bounded worker queue. Package-manager and privileged mutations SHALL be serialized per shared lock domain, and any task failure SHALL produce a non-zero result.

#### Scenario: Concurrent install

- **WHEN** more tasks are ready than the configured worker limit
- **THEN** no more than the configured number start and failures are reported

### Requirement: Plan before mutation

Interactive and headless runs SHALL resolve role, capabilities, network actions, consents, and concurrency into a durable plan before applying system changes.

#### Scenario: Headless plan

- **WHEN** environment values select a headless role and capabilities
- **THEN** a versioned JSON plan is persisted without prompting
