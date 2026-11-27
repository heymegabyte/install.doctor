# Design

**Architect Role:** assigned

Retain the installed control-plane Zod version and the existing release configuration schema. Keep unknown JSON at the read boundary, validate just the object and scalar fields required for composition binding, and compare the original descriptor object to the exact catalog member. Preserving the original objects avoids unintended property reordering in serialization. The builder’s generated evidence already carries its shape, so use its typed structure directly for closure verification. Format numeric manifest fields explicitly using the same string conversion.

Verify the exact builder project with the shared strict lint factory, run the control-plane tooling compiler, and exercise release assembly and its existing rejection cases in disposable local directories.
