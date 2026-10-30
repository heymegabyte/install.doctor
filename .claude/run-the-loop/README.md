# run-the-loop — pointer to the live loop state

The master prompt says: *"Read `.claude/run-the-loop/` + `docs/aid/` loop state FIRST."*

This repo's loop state lives in **`docs/aid/`** (not here). Read these, in order, every fire:

1. **`docs/aid/CURRENT-STATE.md`** — the verified audit (read FIRST). What is built + live-verified vs gated; the live `scripts/test-all.sh` count; the honest blockers.
2. **`docs/aid/NEXT-STEPS.md`** — the resume pointer: the TOP-next action, the CONVERGENCE NOTE, the last-fires log, the human/host-gated Blockers. Byte-ratcheted by the X11 gate.
3. **`docs/aid/MASTER-PROMPT.md`** — the full spec / SSOT (mission + architecture + invariants).
4. **`docs/aid/REQUIREMENTS.md`** — the A01–X15 requirement matrix + the test inventory.
5. **`docs/aid/BACKLOG.md`** — the ranked human-gated frontier (unblock-this-first decision aid).

## The loop

- Cadence: `/loop 15m`, cron `5eaf1b85` (the bootstrap-quality arc, since fire #198). `4002f61a` was the superseded v2 loop.
- Per fire: read the state above → advance ONE verified slice with a **failing test first** → fire-numbered conventional commit to `origin/master` → update the ledgers → record the next concrete action.
- Verify everything: `bash scripts/test-all.sh` (needs `CONTROL_PLANE_URL=https://app.install.doctor` + `AID_ADMIN_TOKEN` for the live-prod suites).
- **⚠️ `app.install.doctor` is being RETIRED → absorbed by `https://desktop.tools`** — do not keep hardening the control-plane surface.

This file is a stable redirect so a session that follows the prompt's instruction literally finds the state instead of an empty directory. It is guarded by `scripts/test-current-state-doc.sh` (X14).
