# Connect the theme.tools research broker

**Architect:** codex
**Architect Role:** assigned

## Why

The Deep Research topology is provisioned as value-free desired state, but agent hosts cannot deterministically locate or authenticate to the broker because the public HTTPS endpoint and its Infisical-backed service-token binding are absent from the manifest.

## What changes

- Declare the broker HTTPS endpoint as non-secret configuration.
- Require `THEME_RESEARCH_SERVICE_TOKEN` as a fixed Infisical reference.
- Emit a dry-run configuration action without resolving either account authority or a secret value.

