# Repository agent guidance

Read CLAUDE.md for the existing fleet provisioning implementation and platform constraints.
For the new app.install.doctor / aid product direction, also read
packages/aid-core/README.md and packages/aid-core/docs/PRODUCT-SPEC.md.

As of 2026-10-26, packages/aid-core is an isolated pre-production TypeScript foundation.
It is not wired into the bootstrap, site, a daemon, or production routing. Do not claim
that browser terminals, OpenCode forking, skill installation, or fleet orchestration are
implemented merely because their interfaces and intended behavior are documented.

New product decisions: app.install.doctor is browser-first; aid is the intended OpenCode
derivative; reuse shared ProjectSites routing with DeepSeek preferred and no LiteLLM;
hiSHtory is preferred over Atuin; Alloy replaces Promtail for new Loki integration work.
Existing history and running services must be preserved until tested migrations exist.

Keep one portable desired-state ENVIRONMENT.md and separate observed-state evidence.
Every future aid launch must create durable History and a recording, including local,
scheduled, child and offline runs. Install approved pinned agent-skills automatically,
but load only the relevant skills into context. Respect least privilege and consent.

Do not reintroduce Nix, require GUI interaction on headless machines, remove platform
paths, or background-replace running applications. Keep secrets out of Markdown exports.
Require approved Figma designs before implementing the full SaaS UI.

Validate the isolated package with: cd packages/aid-core && npm install && npm test.
Preserve the existing master-branch workflow and do not deploy as a side effect of tests.
