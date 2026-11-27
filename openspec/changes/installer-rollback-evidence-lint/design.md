# Design

Keep synchronous work inside the existing promise boundary. Preserve exact run identities and journal validations. Keep original Error instances and attach unexpected non-Error values as causes.
