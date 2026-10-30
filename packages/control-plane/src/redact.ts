// Secret redaction for recorded History content (Q08/U02 — defense-in-depth).
//
// Architecture invariant: "Record safe terminal output and execution events; suppress secret-bearing
// input ... secret values must not enter ... recordings, or generic logs." The PRIMARY defense is
// source-suppression (a recorder that never captures raw secret-bearing input — U02 ⬜, not yet built).
// This is the BOUNDARY backstop: before a device-reported `summary`/`detail` is persisted to the D1
// `history` table (`POST /api/device/report`), scrub known credential shapes so a secret that slips into
// a reported event (e.g. `aid exec deploy --token=ghp_xxx`, an error echoing an API key) never lands in
// plaintext — where it would be readable via `GET /api/device/history` + the admin `/history` dashboard.
//
// HIGH-CONFIDENCE patterns only — known credential shapes + explicit secret-key ASSIGNMENTS (no space
// after the `:`/`=`, so ordinary "the secret: it works" prose is untouched) — biased toward a SAFE
// failure: over-redacting a rare machine-event token loses a word; under-redacting leaks a credential.
// Redaction alone is insufficient (per the invariant) — this layer reduces blast radius, it is not the
// complete solution (the recorder's source-suppression remains the primary control).

const REDACTED = '[REDACTED]';

// [pattern, replacement] applied in order. `$1` preserves a readable label where it helps an operator.
const RULES: Array<[RegExp, string]> = [
  // PEM private-key blocks (multiline)
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, REDACTED],
  // Authorization: Bearer <token>  /  bearer <token>  (keep the keyword, scrub the value)
  [/\b([Bb]earer)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 ' + REDACTED],
  // AWS access-key id
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  // GitHub tokens: classic ghp_/gho_/ghu_/ghs_/ghr_ + fine-grained github_pat_
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
  // OpenAI / Anthropic style sk- / sk-ant-
  [/\bsk-(?:ant-)?[A-Za-z0-9._-]{16,}\b/g, REDACTED],
  // Slack tokens
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  // Explicit secret-ish key ASSIGNMENTS: key=VALUE / key:VALUE / "key":"VALUE".
  // NO `\s*` after the separator → a value must begin immediately (quotes ok), so prose like
  // "secret: it works" (space after the colon) is NOT matched; machine `--token=xyz` / `"api_key":"xyz"` is.
  [
    /\b((?:access[_-]?key|api[_-]?key|apikey|client[_-]?secret|secret|password|passwd|auth[_-]?token|token)["']?[:=]["']?)[^\s"'&,}]{4,}/gi,
    '$1' + REDACTED,
  ],
];

/**
 * Scrub known secret shapes from a string destined for durable History / logs.
 * Pure + deterministic + idempotent. Non-strings pass through unchanged (callers pass the serialized
 * `summary` string and the JSON-serialized `detail` string).
 */
export function redactSecrets<T>(value: T): T {
  if (typeof value !== 'string') return value;
  let out: string = value;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out as unknown as T;
}
