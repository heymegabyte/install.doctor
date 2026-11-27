## ADDED Requirements

### Requirement: Validate consumed response fields

Pairing and device authorization test fixtures SHALL validate the fields they consume from JSON responses.

#### Scenario: A successful response is inspected

- **WHEN** a test consumes a pairing or authorization response
- **THEN** the fields used by that test have been validated and the existing wire assertions remain active
