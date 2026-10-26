# aid — Research & Implementation Ledger

**Status: SCAFFOLD (fire #1). 0 of 1,200 candidates researched.** Every row below is HONEST status — no fabricated research. Future fires fill `categories/Cxx.md` (per-category research + 30 candidates) and `ideas.jsonl` (one JSON object per candidate). Keep long research OUT of always-loaded instructions.

## Protocol (master-prompt §5)
Per category: research ≥3 primary sources → generate 30 distinct candidates → challenge (value/evidence/tradeoffs/license/failure/privacy/deps/acceptance/rollback/cost) → rank `confidence × (2·impact + reuse + unblocking) / (effort + cost + maintenance + risk)` → shortlist 3 → build the best eligible (failing test → code → verify → review → integration evidence) → reassess. Stop a category after 2 review passes yield no higher-value eligible change. Expand the taxonomy only when a genuinely missing category emerges.

## ideas.jsonl record schema
`{id, category, title, user_problem, proposed_behavior, evidence:[{url,date,version}], fact_or_inference, upstream, scoring:{impact,confidence,reuse,unblocking,effort,cost,maintenance,risk}, deps, risk, acceptance_test, status, commit, test_evidence, outcome_metric}`

## 40 categories
| ID | Category | Done | Status |
|----|----------|------|--------|
| C01 | Product usefulness | 0/30 | not-started |
| C02 | Enrollment & activation | 0/30 | not-started |
| C03 | Platform compatibility | 0/30 | not-started |
| C04 | Device lifecycle | 0/30 | not-started |
| C05 | Inventory & evidence | 0/30 | not-started |
| C06 | Desired-state language | 0/30 | not-started |
| C07 | Portability & restore | 0/30 | not-started |
| C08 | Catalog & App Store | 0/30 | not-started |
| C09 | Lazy installation | 0/30 | **partial-impl** — command-not-found SINGLE deployed owner, hardened + reconciled + provision-wired (fire #2–4), 12/12 tested; live-machine proof (gated) + 30-candidate research not started |
| C10 | Configuration convergence | 0/30 | not-started |
| C11 | Integration graph | 0/30 | not-started |
| C12 | Workflow composition | 0/30 | not-started |
| C13 | Distributed execution | 0/30 | not-started |
| C14 | Remote terminals | 0/30 | not-started |
| C15 | Remote desktop/files | 0/30 | not-started |
| C16 | History & replay | 0/30 | not-started |
| C17 | AI routing & capability | 0/30 | **partial-impl** — `/api/ai/v1/resolve` LIVE (fire #7): real routing-POLICY via aid-core `chooseRoute`, Zod-validated, 10/10 (restricted fails closed, premium opt-in); provider CALL + AI-Gateway + research pending |
| C18 | Agent execution quality | 0/30 | not-started |
| C19 | Skills & extensibility | 0/30 | not-started |
| C20 | Personalization | 0/30 | not-started |
| C21 | Replacement & migration advice | 0/30 | not-started |
| C22 | Security architecture | 0/30 | not-started |
| C23 | Identity & secrets | 0/30 | not-started |
| C24 | Privacy & data governance | 0/30 | not-started |
| C25 | Supply chain & provenance | 0/30 | not-started |
| C26 | Reliability & offline use | 0/30 | not-started |
| C27 | Backup & disaster recovery | 0/30 | not-started |
| C28 | Performance & resource use | 0/30 | not-started |
| C29 | Observability & supportability | 0/30 | not-started |
| C30 | Testing & evaluation | 0/30 | not-started |
| C31 | Visual & interaction design | 0/30 | not-started |
| C32 | Accessibility & mobile | 0/30 | not-started |
| C33 | Collaboration & delegation | 0/30 | not-started |
| C34 | API & standards | 0/30 | not-started |
| C35 | Economics & budgets | 0/30 | not-started |
| C36 | Packaging & distribution | 0/30 | not-started |
| C37 | Documentation & DX | 0/30 | not-started |
| C38 | Commercial product & billing | 0/30 | not-started |
| C39 | Acquisition & retention | 0/30 | not-started |
| C40 | Maintainability & ecosystem | 0/30 | not-started |

## Seed requirements S01–S30 (must not be lost in expansion)

> `packages/aid-core` (commit `d6e00879`, 52/52 green) gives **CONTRACT-LEVEL** partial coverage — tested pure functions, NOT a running/deployed surface: **S01** (v1 ENVIRONMENT.md round-trip + digest; no migrations past v1), **S07** (provider config + `chooseRoute` + 8 aliases; no protocol test vs the real service), **S11/S29** (Loki plan + Alloy fragment only), **S13/S14/S15** (session lifecycle + asciicast v3 formatter only — `CastWriter` is not a PTY/recorder/player). Statuses below stay `not-started` for the DEPLOYED-product work those seeds ultimately require.

| ID | Required outcome | Category | Status |
|----|------------------|----------|--------|
| S01 | Lossless ENVIRONMENT.md export/import + migrations | C06/C07 | not-started |
| S02 | Desired-vs-observed diffs, freshness, honest offline | C05/C10 | not-started |
| S03 | Role overlays, machine exceptions, restore previews | C06/C07 | not-started |
| S04 | One-link enrollment + auto aid + approved skills | C02/C19 | not-started |
| S05 | Non-destructive adoption of existing machines | C04/C10 | not-started |
| S06 | App-store Installed→Configured→Connected→Healthy probes | C08 | not-started |
| S07 | Shared ProjectSites/OnePrompt DeepSeek routing + protocol tests | C17 | not-started |
| S08 | Verification-driven escalation + independent review | C18 | not-started |
| S09 | Whole-task budgets (retries, children, cost/success) | C35 | not-started |
| S10 | Multi-machine dependency graphs, leases, offline queues, dedupe | C13 | not-started |
| S11 | Tested service bindings (Coolify/Grafana/Loki first) | C11 | not-started |
| S12 | Impact previews, canaries, blast-radius, honest recovery | C12/C27 | not-started |
| S13 | Persistent browser PTYs + detach/stop/recovery | C14 | not-started |
| S14 | History registration for EVERY aid launch (incl. offline/child) | C16 | not-started |
| S15 | Searchable replay correlated with diffs/checks/cost/capture | C16 | not-started |
| S16 | Automatic pinned skill install + reversible verified updates | C19 | not-started |
| S17 | Task-scoped skill loading + bounded capability grants | C19/C22 | not-started |
| S18 | Evaluated, independently-reviewed skill self-improvement | C19/C30 | not-started |
| S19 | Local-first hiSHtory analysis, no default cloud upload | C20/C24 | **partial** — hiSHtory adopted as canonical (ADR 0001, fire #5); local-first analysis UI not built |
| S20 | Drop-in / adapter / migration replacement reports | C21 | not-started |
| S21 | Convert repeated workflows into tested automations | C12 | not-started |
| S22 | Managed blocks, 3-way merges, Maintain/Optimize modes | C10/C22 | not-started |
| S23 | Offline deterministic provisioning + resumable jobs | C26 | not-started |
| S24 | Restore drills + OS-matrix fault tests | C24/C30 | not-started |
| S25 | Independent capture/analysis/learning consent + deletion | C24 | not-started |
| S26 | Least-privilege helpers, scoped creds, signed releases | C22/C25 | not-started |
| S27 | Tenant isolation, per-device revocation, fleet e-stop | C22/C27 | not-started |
| S28 | Accessible, keyboard-first, responsive UX + real states | C31/C32 | not-started |
| S29 | OTel/Alloy outcome metrics (readiness/drift/failures/cost) | C29 | not-started |
| S30 | Team bundles, approved catalogs, paid fleet, unrestricted export | C38 | not-started |

## 14 expansion hypotheses (master-prompt §14) — all not-started
Readiness graph · change capsules · environment rehearsal · compatibility evidence registry · outcome-oriented setup · session→runbook · coordinated migrations · capability-based placement · policy-conflict diagnosis · support capsules + handoff · savings reports · exit/replacement rehearsal.
