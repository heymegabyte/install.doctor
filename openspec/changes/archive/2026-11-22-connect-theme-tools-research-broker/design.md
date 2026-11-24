# Design: theme.tools research broker host binding

**Architect:** codex
**Architect Role:** assigned

The existing theme.tools research provisioning manifest remains authoritative. A strict `broker` object owns the environment-specific HTTPS endpoint and the fixed environment-variable name consumed by the agent-skills rail. The token itself remains exclusively in `secretReferences` and must resolve to the workload identity's fixed Infisical leaf. Planning emits an idempotent, non-mutating configuration-reference action; it never reads or prints the token value.

