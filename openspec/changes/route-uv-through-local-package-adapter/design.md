# Design

Remove the supplemental uv indexes from the native template, post-install generator, and shell defaults. Preserve the explicit default index override and the local cache settings. Verify a native install with a fresh uv cache. Authenticated Nexus delivery still depends on a scoped service identity.

The same default applies to pip. Its native install report must identify the local adapter as the wheel source and match the recorded digest.

Go uses the same adapter default in interactive shells and Go’s native configuration. Verified the native module checksum on Legion and the interactive proxy selection.
