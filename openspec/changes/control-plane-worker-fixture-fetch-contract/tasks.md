# Tasks

- [x] Verify the bundle exposes fetch and responds with a Response.
- [x] Compare strict lint findings and run the existing HTTP tests.

The Worker fixture retains the original receiver and arguments at all 103 call sites. Strict findings in the suite fell from 1,132 to 303. The test compiler and bundled HTTP suite passed.
