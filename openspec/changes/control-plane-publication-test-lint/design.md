# Design

**Architect Role:** assigned

Keep the existing fixture data, storage failure injection, and signature and manifest checks. Give the fake storage maps explicit key and value types, preserve method binding by calling storage through its object, and convert fixture numbers to text when building canonical manifests and ETags. Treat parsed receipts and channels as unknown until assertions establish the observed fields.

Run the shared strict lint profile for the two files, the Control Plane test compiler, and the focused runtime suites.
