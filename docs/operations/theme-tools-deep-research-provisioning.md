# theme.tools Deep Research provisioning

install.doctor owns the reusable desired-state boundary for the Cloudflare account resources and Infisical workload references required by theme.tools Deep Research. Runtime code, D1 migrations, connector policy, research behavior, and product screens remain owned by theme.tools and its consumers.

## Contract

`@install-doctor/aid-core/theme-tools-research-provisioning` validates:

- one Worker service and account reference;
- D1 metadata, R2 evidence, KV configuration cache, job Queue and DLQ;
- a per-run Durable Object and checkpointed Workflow;
- Browser Rendering, Workers AI, and an integration-event service binding;
- the internal `RESEARCH_BRANCH_EXECUTOR` binding from the Workflow owner to the named `ResearchBranchService` entrypoint;
- the branch service's `RESEARCH_EGRESS` binding to a separately declared policy-enforcement service, with one matching `theme-egress://` policy reference;
- Cloudflare Browser Run through the exact `BROWSER` binding and `RESEARCH_BROWSER_EGRESS` named-entrypoint route;
- the fixed Infisical reference for `RESEARCH_BROWSER_DESCRIPTOR_KEY`, shared by the branch descriptor issuer and `ResearchBrowserEgressService` verifier without resolving its value;
- one independently revocable Infisical workload identity with fixed leaf references;
- the credential-free `THEME_RESEARCH_ENDPOINT` and Infisical-backed `THEME_RESEARCH_SERVICE_TOKEN` binding used by the agent-skills broker rail;
- explicit product-Worker service bindings into the canonical research Worker, including the OnePrompt staging `RESEARCH` binding and a server-controlled authority grant reference;
- explicit evidence, event, and usage retention periods.

`buildInstallDoctorProvisioningSpec()` is intentionally dry-run-only. It returns deterministic idempotency keys, validation actions, rollback metadata, and exact external requirements. It does not resolve secret values, call Cloudflare, enroll an Infisical identity, apply migrations, deploy a Worker, or authorize spend.

The consumer binding is transport reachability, not user or tenant authority. Deployment-configured Cloudflare service-binding `props` attest the consumer, environment, authority-grant reference, and scope-header names to the named entrypoint. The research Worker resolves that reference in its authoritative grant store and derives service, grants, and authorization generation server-side; product-supplied tenant/actor headers remain bounded scope hints only. Consumer declarations cannot contain endpoint URLs, tokens, or credentials, must target the canonical Worker in the same declared environment, and preserve any existing binding during rollback.

The internal runtime topology is independently explicit. The Workflow service can reach branch execution only through `RESEARCH_BRANCH_EXECUTOR`, which targets `ResearchBranchService` with bounded non-secret properties for provider identity, endpoint, readiness, retention, concurrency, and egress policy. The branch service can perform search and ordinary source retrieval only through `RESEARCH_EGRESS`; direct global-fetch fallback is forbidden. Browser escalation uses the exact virtual host `research-browser.invalid` and `RESEARCH_BROWSER_EGRESS` to reach the named `ResearchBrowserEgressService`. That service delegates verified upstream requests through the same policy-egress service used by ordinary retrieval. Every runtime service and binding remains in the manifest's environment and Cloudflare account.

Browser Rendering is enabled only as `policy_routed_v1`. The Browser Run binding, branch properties, browser-egress entrypoint properties, and outbound routing all require the exact `research-browser.invalid` hostname. Both descriptor issuer and verifier receive `RESEARCH_BROWSER_DESCRIPTOR_KEY` from the fixed Infisical workload leaf; the manifest and dry-run plan contain only its reference. The browser-egress response limit is bounded from 1,024 through 10,000,000 bytes, and neither the browser nor ordinary route may declare direct global-fetch fallback.

## External setup still required

An account-bound apply requires all of the following independently:

1. A Cloudflare account identifier and token restricted to the declared resource and Worker operations.
2. Permission to create or bind D1, R2, KV, Queues, Durable Objects, Workflows, Browser Rendering, Workers AI, and service bindings.
3. An Infisical project plus one workload identity scoped only to `/workloads/theme-tools-research`.
4. Provisioned values for declared secret references, including the dynamic-token encryption key. The key value must never enter this repository or the plan.
   `THEME_RESEARCH_SERVICE_TOKEN` must be scoped to the declared tenant/environment service authority and delivered only at runtime; it must not be passed in CLI arguments or emitted to stdout.
5. Approved environment budgets, retention periods, migration window, deployment authority, and rollback owner.
6. Deployment permission for each consumer Worker, including OnePrompt, and confirmation that it shares a Cloudflare account with the research Worker or uses an explicitly supported alternative architecture.
7. A deployed research service-binding entrypoint plus a server-controlled OnePrompt caller/grant record that enforces tenant policy; binding reachability alone is insufficient.
8. Deployment permission for the declared Workflow, branch, and policy-egress Workers, including named-entrypoint properties and both internal service bindings.
9. Cloudflare network-policy authority and a deployed egress service that enforces DNS, redirect, private/metadata destination, body, and destination restrictions for every configured search and source request.
10. A deployed credential-free SearXNG endpoint matching the branch declaration, plus executed evidence that ordinary search and source retrieval cannot bypass `RESEARCH_EGRESS`.
11. A provisioned `RESEARCH_BROWSER_DESCRIPTOR_KEY` value at the declared Infisical leaf, delivered to both runtime consumers without entering logs, plans, repository state, or command arguments.
12. Remote evidence that Browser Run routes only `research-browser.invalid` through `ResearchBrowserEgressService`, enforces the bounded response policy, and then reaches the same `RESEARCH_EGRESS` service without a direct fallback.

Local validation and dry-run evidence must not be described as a Cloudflare sandbox deployment, Infisical enrollment, secret delivery, provider verification, or production observation.
