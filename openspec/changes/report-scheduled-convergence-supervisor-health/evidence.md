# Evidence

Verified 2026-11-13 on macOS against the live OnePrompt shared-controller state.

- Published implementation revision: `af1c958d841bd638a596df888322dbd8ad7bb6e8`.
- Installed source and `/Users/Apple/.local/bin/oneprompt-convergence-supervisor` both had SHA-256 `128648899e6da92e0072d3de2a995ff919cd059c80a0951ef679d23df7f0f446`.
- Red: the disposable launchd fixture failed `scheduled-waiting-health` before the status classifier changed.
- Green: `bash scripts/test-oneprompt-convergence-supervisor.sh` passed launchd and systemd scheduled-waiting assertions plus the OnePrompt shared-controller fixture (12 tests).
- `bash -n home/dot_local/bin/executable_oneprompt-convergence-supervisor` passed.
- `npx openspec validate report-scheduled-convergence-supervisor-health --type change --strict --no-interactive` passed. Repository-wide validation remained nonzero only for the unrelated pre-existing untracked `ai-finops-mission-control-observatory` change, which has no delta spec.
- Live waiting receipt: `healthy=true`, `managerState=scheduled`, `artifactCompatible=true`, durable mode `running`, `workerLiveness=waiting`, `currentOwner=null`, epoch 143.
- Live active receipt after the ordinary repository-native start command: `healthy=true`, `managerState=active`, fresh heartbeat/current progress/alive process, epoch 144, checkpoint `attempt-144`.
- The managed definition retains `StartInterval=900` and `KeepAlive=false`; cadence and worker admission policy were not changed.
