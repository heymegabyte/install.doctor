# Prevent offline inventory drift during template changes

Repeated changes to tracked secret template filenames have left the metadata counts and digests stale. Linux run 45935166392 observed 377 entries against an expected 369 and failed the Aid Core inventory check.

Make the existing template maintenance path verify the generated filename metadata before committing a template set change. This is a proposed follow-up for the owner of the offline inventory workflow. It requires no access to secret values and leaves the reviewed exception policy with its existing owners.
