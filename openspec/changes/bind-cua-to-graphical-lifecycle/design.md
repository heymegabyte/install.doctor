> **Architect:** codex
> **Architect Role:** assigned

The native user manager owns the Linux launcher. Validate the new unit,
preserve an exact rollback copy of the generated legacy unit, remove its
known default-target link, and let the GUI session own display environment.
Require an active graphical target before runtime activation. A custom unit
or link requires review. Apply as the user and leave an active driver running.

[systemd graphical session targets](https://www.freedesktop.org/software/systemd/man/259/systemd.special.html)
