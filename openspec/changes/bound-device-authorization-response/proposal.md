## Why

The device authorization transport clears its timeout and caller abort listener as soon as Fetch returns headers. A poll with partial JSON remained pending after the configured one-second deadline in a controlled streaming probe.

## What Changes

Keep the guarded request alive through bounded response decoding for start and poll. Preserve status handling and credential transport.
