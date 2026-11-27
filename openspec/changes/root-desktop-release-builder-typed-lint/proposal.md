# Type-check Desktop Tools release builder boundaries

**Architect Role:** assigned

## Why

The release builder uses unchecked JSON values for Debian composition and catalog authority. Its current strict ESLint baseline has 80 findings, including unsafe access to nested metadata that determines what enters the release.

## What changes

- Treat decoded release inputs as untrusted until the builder narrows the fields it uses.
- Keep exact byte and catalog bindings and preserve deterministic manifest, SPDX, SBOM, and provenance output.
- Bring the builder into conformance with the shared strict typed lint profile.

## Impact

This change covers the local unsigned release builder. Validation uses disposable fixtures and never attempts publication.
