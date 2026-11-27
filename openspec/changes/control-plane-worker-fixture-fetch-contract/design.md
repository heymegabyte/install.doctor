# Design

Treat the dynamic module and the fetch result as unknown until their shapes are checked. Preserve the receiver, request, and environment passed to the bundle. Leave response body schemas and production Worker behavior to their existing owners.
