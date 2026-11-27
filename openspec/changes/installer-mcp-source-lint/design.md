## Approach

Read parsed JSON as unknown, narrow object fields before dispatch, and normalize request IDs to the supported scalar types. Preserve the protocol methods, error classes, notification handling, and the existing runtime adapter validation. Reuse the pinned Node and shared typed lint setup.
