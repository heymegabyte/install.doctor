# Design

Use the existing Aid Core inventory refresh command. It computes the metadata
from tracked filenames and validates the result against the normal inventory
schema. Compare the JSON before and after the refresh to verify that only the
reported store's count and digest change.
