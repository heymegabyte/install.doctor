# Installer Engine source lint

## ADDED Requirements

### Requirement: Installer Engine source has complete strict typed lint coverage

The standard Installer Engine source lint command SHALL apply the shared strict typed profile to the full TypeScript source glob.

#### Scenario: Check the engine source and scheduler behavior

- **WHEN** the Installer Engine package is verified
- **THEN** the engine source passes strict typed lint and retains plan digest, scheduler, compensation, and journal behavior.
