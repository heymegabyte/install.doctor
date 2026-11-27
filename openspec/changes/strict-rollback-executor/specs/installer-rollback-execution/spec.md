## ADDED Requirements

### Requirement: Strict configuration rollback execution

The configuration rollback executor SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: A compensation task restores service state

- **WHEN** an approved configuration compensation requires service restoration
- **THEN** the existing observer admission and mutation callbacks execute before the service restore.
