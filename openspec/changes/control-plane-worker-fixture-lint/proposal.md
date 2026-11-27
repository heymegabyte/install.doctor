# Validate the shared Worker test fixture boundaries

The shared bundled Worker fixture trusts the dynamically loaded module and the SQLite adapter retrieved from the global object. Validate both runtime boundaries and enroll the helper in strict typed lint.
