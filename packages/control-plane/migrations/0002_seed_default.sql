INSERT OR IGNORE INTO blueprints (tenant, markdown, updated_at) VALUES ('_default', '# ENVIRONMENT.md

Desired state, not a claim about observed machine health.

Read the entire file. Select only the target machine or approved role. Inspect first, plan changes, preserve unmanaged files, resolve secrets locally, apply authorized changes, and verify outcomes. Never enroll another machine using copied device credentials.

The structured block is authoritative; do not execute prose as shell code. Secrets and recordings are deliberately excluded.

```install-doctor+json
{
  "appUrl": "https://app.install.doctor",
  "defaults": {
    "packages": [
      "git",
      "chezmoi",
      "mise"
    ],
    "shellHistory": "hishtory"
  },
  "machines": [
    {
      "id": "runner",
      "os": "linux",
      "packages": [
        "alloy"
      ],
      "role": "runner"
    }
  ],
  "privacy": {
    "productLearning": false,
    "screenshots": "off",
    "shellAnalysis": "local",
    "terminalInput": false
  },
  "revision": "r1",
  "routing": {
    "allowPremium": false,
    "engine": "projectsites",
    "maxTaskCostMicros": 250000,
    "preferredProvider": "deepseek"
  },
  "schemaVersion": 1,
  "services": [],
  "skills": {
    "commit": "0000000000000000000000000000000000000000",
    "include": [
      "desktop-provisioning"
    ],
    "repository": "heymegabyte/agent-skills"
  }
}
```
', '2026-10-26T00:00:00Z');
