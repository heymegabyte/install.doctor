## ADDED Requirements

### Requirement: Fixture preserves asynchronous D1 semantics

The local SQLite adapter SHALL return promises from its D1 read and run methods.

#### Scenario: SQLite rejects an invalid operation

- **WHEN** a fixture operation triggers a SQLite error
- **THEN** the adapter returns a rejected promise and preserves the error for the existing assertions
