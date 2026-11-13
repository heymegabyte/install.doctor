# OnePrompt convergence host supervisor

install.doctor owns only the portable service-manager boundary. OnePrompt owns the controller machine interface and bounded worker; `@theme.tools/workflows` owns fenced SQLite state.

Pinned compatibility: OnePrompt `71cd170b518452af3702fe4229de393506f58021`; machine-interface SHA-256 `a624ff2bcf571b2408a7f5e4715450c6196683bda08acfba229ddb00b0b49b36`; workflows `1.0.0` at SHA-256 `ecdd6446a0c3aae7574514a1959f24bd83a6ff02e8f81ae9e012dd6af6dd216c`; state schema 2; service identity `tools.theme.oneprompt.converge`.

```bash
oneprompt-convergence-supervisor install --repo /absolute/oneprompt.site-2 \
  --machine-interface /absolute/controller-machine \
  --revision 71cd170b518452af3702fe4229de393506f58021
```

Install is byte-stable and inert. The controller executable receives `install|status|verify|pause|resume|stop --json --migration-mode safe|forbid`, reads `ONEPROMPT_CONVERGENCE_STATE_DIR`, and returns JSON. Only install may use safe migration. Pause/stop commit SQLite intent before manager termination. Start never clears durable intent; resume explicitly transitions to running after artifact and definition revalidation.

Status keeps manager, worker, heartbeat, progress, checkpoint, blockers, budgets, and artifact evidence separate. `managerState: active` means a bounded worker is executing; `managerState: scheduled` means the canonical launchd job or systemd timer is loaded between invocations; `managerState: inactive` means no admitted schedule was observed. A scheduled service is healthy only with compatible artifacts, durable `running` intent, no current owner, and `workerLiveness: waiting`. Logs are diagnostic only. Uninstall removes only an unchanged adapter-managed definition and retains stopped state.

`adopt-plan` is read-only. `adopt` accepts only an inactive adapter-managed legacy definition, creates a permission-restricted recovery bundle, migrates through `scripts/convergence-machine.mjs`, retains the most restrictive intent, and installs the canonical definition inactive. `rollback` stops and unloads canonical state, verifies no owner, restores the recorded database/config/legacy definition, and leaves explicit stopped intent. Neither operation starts a service.

```bash
bash -n home/dot_local/bin/executable_oneprompt-convergence-supervisor
bash scripts/test-oneprompt-convergence-supervisor.sh
npx openspec validate adopt-shared-oneprompt-convergence-controller --strict --no-interactive
```

Tests use disposable homes, a temporary git checkout, a fake controller, and fake launchd/systemd managers. They never inspect or mutate live state.
