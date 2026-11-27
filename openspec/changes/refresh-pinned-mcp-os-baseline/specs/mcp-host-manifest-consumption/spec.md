## ADDED Requirements

### Requirement: Digest-verified canonical host selection

The consumer SHALL load only the pinned, digest-verified canonical manifest pair for the detected macOS or Ubuntu host, and each pinned human and automation profile SHALL expose the verified Megabyte OS public grant without remote host-control or candidate-only third-party grants.

#### Scenario: Load the pinned host pair

- **WHEN** the consumer loads the vendored manifests for a supported host
- **THEN** both manifests pass revision, source-digest, and artifact-digest verification
- **AND** both contain exactly the `megabyte-os-public` server grant
- **AND** local host controls and candidate-only third-party services are absent from remote grants
