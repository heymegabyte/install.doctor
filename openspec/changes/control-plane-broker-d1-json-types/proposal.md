# Contain unchecked JSON at broker D1 reads

Strict lint identified five JSON decodes whose inferred any escapes the read expression across the broker approval, exact-plan, and run-intent stores. Existing semantic schemas validate these values. Make the unchecked type explicit at the reader so future edits must preserve validation.
