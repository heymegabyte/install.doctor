# Keep Arch CI prerequisites compatible with the pinned base image

**Architect Role:** assigned

The Arch structural job refreshes package metadata and installs prerequisites without upgrading the image. The resulting OpenSSL dependency conflict stops qualification before the smoke checks. Use a full upgrade in the prerequisite transaction.
