# Design

Capture decoded D1 JSON as unknown before handing it to the existing canonical schema. Where validation occurs in a consumer, preserve that location and error behavior. Use the existing D1 fixtures to check valid records, rejected records, and persistence parity. This scope excludes Better Auth type resolution and the Worker route handler rollout.
