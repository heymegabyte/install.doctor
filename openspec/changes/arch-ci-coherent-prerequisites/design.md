# Design

**Architect Role:** assigned

Run the rolling repository refresh, system upgrade, and smoke prerequisite installation in one package manager transaction. Retain the pinned container and the existing required packages. Keep normal package signature and dependency validation. The other distribution jobs and support admission checks continue with their existing configuration.
