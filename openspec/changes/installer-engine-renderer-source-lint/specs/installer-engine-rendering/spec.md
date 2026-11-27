# Installer Engine rendering

## ADDED Requirements

### Requirement: Renderer source passes strict typed lint

The Installer Engine renderer SHALL pass the shared strict typed lint profile while preserving its existing public presentation contracts.

#### Scenario: Render bounded terminal output

- **WHEN** a renderer projects an event stream or a width-limited terminal frame
- **THEN** its displayed status, event order, control handling, and cell-width truncation follow the established contracts.
