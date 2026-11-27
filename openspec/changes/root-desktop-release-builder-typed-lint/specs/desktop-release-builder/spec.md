## ADDED Requirements

### Requirement: Typed unsigned release input and evidence

The unsigned release builder SHALL explicitly narrow fields used from raw Debian trust, composition, and catalog JSON and SHALL pass the shared strict typed lint profile. It SHALL preserve the resulting immutable artifact identities and the serialized release evidence for admitted inputs.

#### Scenario: Exact source closure produces the release

- **WHEN** the builder receives admitted configuration and matching release inputs
- **THEN** it emits deterministic release metadata and the exact expected unsigned payload closure

#### Scenario: Substituted composition authority is rejected

- **WHEN** the Debian composition metadata or corresponding catalog member fails the existing binding checks
- **THEN** assembly fails before publishing an output directory
