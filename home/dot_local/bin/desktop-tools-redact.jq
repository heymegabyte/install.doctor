# Q08/U02 — SOURCE-side secret redaction for the aid client's outgoing History reports.
#
# Mirrors packages/control-plane/src/redact.ts (the server BOUNDARY backstop, fire #189). The architecture
# invariant makes SOURCE-suppression the PRIMARY control ("disable sensitive capture at its source; later
# redaction alone is insufficient"): a secret in a caller-provided report field (`aid report --detail`,
# the `command` field in `aid apply`'s detail) must never LEAVE the host in plaintext — even though the
# control plane also redacts before persisting. This filter walks EVERY string in the outgoing report body
# and scrubs high-confidence credential shapes. Idempotent; safe-failure-biased (a rare mangled word beats
# a leaked credential). Loaded by `aid` postReport via `jq -c -f`; unit-tested in scripts/test-aid-client.sh.
def redact:
  gsub("-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----"; "[REDACTED]")
  | gsub("[Bb]earer\\s+[A-Za-z0-9._~+/=-]{8,}"; "Bearer [REDACTED]")
  | gsub("AKIA[0-9A-Z]{16}"; "[REDACTED]")
  | gsub("gh[pousr]_[A-Za-z0-9]{20,}"; "[REDACTED]")
  | gsub("github_pat_[A-Za-z0-9_]{20,}"; "[REDACTED]")
  | gsub("sk-(ant-)?[A-Za-z0-9._-]{16,}"; "[REDACTED]")
  | gsub("xox[baprs]-[A-Za-z0-9-]{10,}"; "[REDACTED]")
  | gsub("(?<k>(?:access[_-]?key|api[_-]?key|apikey|client[_-]?secret|secret|password|passwd|auth[_-]?token|token)[\"']?[:=][\"']?)[^\\s\"'&,}]{4,}"; "\(.k)[REDACTED]"; "i");
walk(if type == "string" then redact else . end)
