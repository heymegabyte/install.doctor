## Why

The offline sandbox adapter and orchestrator sit outside the normal Installer Engine strict source gate.

## What Changes

Enable strict lint for both modules and explicitly narrow runtime dependencies before executing a verified offline plan.
