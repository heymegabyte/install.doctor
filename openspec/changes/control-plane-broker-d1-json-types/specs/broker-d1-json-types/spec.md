## ADDED Requirements

### Requirement: D1 JSON remains unchecked until validation

Broker D1 readers SHALL represent decoded JSON as unknown before canonical schema validation.

#### Scenario: A stored broker row is decoded

- **WHEN** a broker D1 reader decodes persisted JSON
- **THEN** the configured validator keeps its existing acceptance and rejection behavior and no inferred any escapes into the typed consumer
