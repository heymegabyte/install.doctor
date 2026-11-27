# Design

**Architect Role:** assigned

Convert display numbers to strings explicitly. Use the validated event status directly and remove the unused retained-output count. Iterate the input string by Unicode code point in both passes of the existing width algorithm. Keep the current cell-width calculation and ellipsis policy.

Verify the renderer with the repository's shared strict profile on Node 24.22.2 and run the Installer Engine tests, including the renderer and real PTY fixtures. Shared lint admission belongs to integration.
