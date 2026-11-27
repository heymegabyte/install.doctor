## ADDED Requirements

### Requirement: Check offline inventory metadata with template changes

The maintenance check SHALL detect stale template counts or filename digests without reading template contents.

#### Scenario: A template is added or removed

- **WHEN** a tracked regular filename in a catalogued store changes
- **THEN** verification fails until the derived count and digest reflect the tracked filenames
