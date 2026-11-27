# Design

Resolve synchronous SQLite calls within a Promise executor so driver errors still become rejected promises. Make test identifiers explicitly textual and use statement blocks in synchronous rejection assertions. Keep the changes within the local fixtures.
