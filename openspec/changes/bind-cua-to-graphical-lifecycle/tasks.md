- [x] Bind the managed Linux unit to the graphical session and validate the known legacy unit migration.
- [x] Verify the installed unit and enablement on Legion without interrupting the active driver.
- [x] Verify the target startup and stop relationship without logging out the active desktop.

The November 28 disposable systemd user target on Legion started
a fixture service using the new unit's graphical lifecycle directives
and a harmless placeholder process. The process inherited the actual
user manager's X11 and Wayland variables. Stopping the fixture target
stopped the fixture service. All fixture unit files were removed and
the real Cua service retained PID 1230329. A separate hook fixture
proved reapply uses one enablement and leaves custom units untouched.

Live Legion deployment of `d71cf66d` installed helper digest
`1bd635d0eda9f95542c51a8646aaad5aa0d94b1efa306a140bf40720f1357806`,
unit digest
`6bdadafb72111948e449f8d646168f2c0696a022401bfe5b4925b168777ce091`,
and host hook digest
`5772c1d5579651b53d961dc44af81c920fbf260ac84b95c83210677b887fa563`.
The loaded default target omitted Cua Driver, the loaded graphical
target wanted it, and the daemon remained active on PID 1230329.
Repeating the installed convergence helper preserved the unit digest
and PID. This did not log out the physical session.

The previous unit and hook are under
`~/.local/state/install-doctor/cua-unit-rollback-03b4ad1d` and
`~/.local/state/install-doctor/cua-hook-rollback-a72552ff`.
For rollback, stage and verify those files before replacing the
current unit and hook. Re-enable the reviewed prior unit and reload
the user manager without restarting the active driver. The prior
default-target activation permits headless startup.
