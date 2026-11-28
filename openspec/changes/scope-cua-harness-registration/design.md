## Context

The existing hook configures the desktop daemon and edits the configuration of Claude Code, Codex, OpenCode, and Antigravity in one execution.

## Decision

The post-install hook owns driver configuration and startup. Use the installed upstream agent setup command or a harness's own configuration path for separately authorized registration. Do not reconcile or delete historical agent entries automatically. Existing approved package provenance and desktop consent remain prerequisites.
