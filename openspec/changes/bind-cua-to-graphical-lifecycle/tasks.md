- [x] Bind the managed Linux unit to the graphical session and validate the known legacy unit migration.
- [ ] Verify the installed unit and enablement on Legion without interrupting the active driver.
- [x] Verify the target startup and stop relationship without logging out the active desktop.

The November 28 disposable systemd user target on Legion started
a fixture service using the new unit's graphical lifecycle directives
and a harmless placeholder process. The process inherited the actual
user manager's X11 and Wayland variables. Stopping the fixture target
stopped the fixture service. All fixture unit files were removed and
the real Cua service retained PID 1230329. A separate hook fixture
proved reapply uses one enablement and leaves custom units untouched.
