# Design

## Context

The worker is intentionally bounded. launchd uses `StartInterval=900` with `KeepAlive=false`; systemd uses a persistent timer and a oneshot service. Between invocations the service process is absent while the manager definition remains loaded and capable of scheduling the next pass.

## Decision

The adapter observes manager execution and manager scheduling separately. `managerState` has three externally visible states:

- `active`: the bounded worker process is currently executing.
- `scheduled`: the canonical launchd job or systemd timer is loaded/enabled, but no worker is executing.
- `inactive`: the manager has neither an active worker nor an admitted schedule.

Health is true for the existing active/current controller state. It is also true for `scheduled` only when the shared controller reports durable `running` intent, no current owner, and `workerLiveness=waiting`. Artifact compatibility remains mandatory in both cases. Paused, stopped, stale-owned, corrupt, or incompatible states remain unhealthy.

## Verification

Disposable fake-manager tests exercise the state transitions without touching the live service. A live post-install receipt must then show `scheduled` while waiting and `active` after an authorized start.
