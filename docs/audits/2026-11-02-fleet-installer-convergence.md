# Fleet installer convergence — 2026-11-02

Five focused passes were applied to the requested repository-wide change.

1. **Bootstrap and interaction** — replaced process substitution with a private temp-file stage zero; added checksum support, terminal-safe stdin, headless fallback, cleanup, and control-plane regression assertions.
2. **Execution and selection** — replaced eager zx promises with lazy bounded workers, fixed multi-root dependency expansion, propagated task failures, added a durable install plan, and added the Gum role/capability/network review.
3. **Catalog and migrations** — added uv as the default, made Poetry opt-in, retired Tailscale/Trayscale recipes and automation, regenerated the control-plane catalog, and locked the policy with tests.
4. **Security and network** — removed Tailscale secret export/population and implicit firewall trust; retained consent boundaries and did not uninstall or stop an existing live daemon.
5. **Consistency and agent throughput** — added Codex/Gemini project pointers to the canonical OpenCode/LiteLLM policy, generated the complete catalog audit, validated OpenSpec, and ran control-plane, catalog, syntax, and policy gates.

The generated [`artifacts/software-catalog-audit.json`](../../artifacts/software-catalog-audit.json) contains every catalog entry, sorted by GitHub stars when `--github` data is requested. It supplies deterministic fallback names/descriptions for review without inventing upstream facts in `software.yml`. On this run GitHub credentials were unavailable, so volatile star counts remain `null`; run:

```bash
GITHUB_TOKEN=... node scripts/audit-software-catalog.mjs --github \
  --output=artifacts/software-catalog-audit.json
```

Remaining source metadata gaps are evidence-gated rather than hallucinated: 205 entries lack at least one upstream fact or install recipe. The audit makes each gap explicit. A future authenticated enrichment run can fill stars, archived status, and freshness, after which cohort-relative replacements can be approved with migration and rollback evidence.
