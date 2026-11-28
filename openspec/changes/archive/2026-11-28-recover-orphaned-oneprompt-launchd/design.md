## Decisions

The release maintainer owns this whole change. The operator must explicitly supply the absent predecessor repository path. The parsed program, working directory, state directory, and recognized environment and schedule fields must agree with the known adapter definition. The qualified new checkout and machine interface are checked before the old definition moves. A recovery copy remains available, and the adopted controller is explicitly stopped. Tests use a fake manager and disposable state.

The orphan-only path binds its machine command to the pinned checkout and rejects changes to tracked replacement code. An injected installation failure after unloading must restore the original definition from the recovery bundle before returning failure. The restored definition remains unloaded.

For orphaned predecessors, recovery uses a SQLite-consistent snapshot. Definition rollback retains the current stopped database and attempt history instead of replacing it with the backup.
