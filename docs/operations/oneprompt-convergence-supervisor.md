# OnePrompt convergence host supervisor

install.doctor owns only the portable service-manager boundary. OnePrompt owns the controller machine interface and bounded worker; `@theme.tools/workflows` owns fenced SQLite state.

Pinned compatibility: OnePrompt `e3baa31f086e9052fff13928429b74777fcecdb6`; workflows `1.0.0` at SHA-256 `bcdbac76045a97091e864915e52fb2fe588a3c0711f067f583ac053f0d24a0fb`; state schema 2; service identity `tools.theme.oneprompt.converge`.

```bash
oneprompt-convergence-supervisor install --repo /absolute/oneprompt.site-2 \
  --machine-interface /absolute/controller-machine \
  --revision e3baa31f086e9052fff13928429b74777fcecdb6
```

Install is byte-stable and inert. The controller executable receives `install|status|verify|pause|resume|stop --json --migration-mode safe|forbid`, reads `ONEPROMPT_CONVERGENCE_STATE_DIR`, and returns JSON. Only install may use safe migration. Pause/stop commit SQLite intent before manager termination. Start never clears durable intent; resume explicitly transitions to running after artifact and definition revalidation.

Status keeps manager, worker, heartbeat, progress, checkpoint, blockers, budgets, and artifact evidence separate. Logs are diagnostic only. Uninstall removes only an unchanged adapter-managed definition and retains stopped state.

`adopt-plan` is read-only. Mutation adoption and rollback are blocked until the pinned OnePrompt revision exposes the specified host-neutral executable: its `scripts/converge.mjs` still performs launchd operations and cannot safely serve as install.doctor's state-only interface.

```bash
bash -n home/dot_local/bin/executable_oneprompt-convergence-supervisor
bash scripts/test-oneprompt-convergence-supervisor.sh
npx openspec validate adopt-shared-oneprompt-convergence-controller --strict --no-interactive
```

Tests use disposable homes, a temporary git checkout, a fake controller, and fake launchd/systemd managers. They never inspect or mutate live state.
