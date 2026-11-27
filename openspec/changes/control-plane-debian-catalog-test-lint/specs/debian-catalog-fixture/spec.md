## ADDED Requirements

### Requirement: Strict lint for the Debian catalog merge fixture
Control Plane fixture lint SHALL check the Debian native catalog merge test.

#### Scenario: Compare merged output to the input catalog
- **WHEN** the test reads an unchecked JSON catalog
- **THEN** it validates the array before comparing merged entries and narrows the expected tree entry before inspecting its fields
