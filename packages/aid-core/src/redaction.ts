import { z } from 'zod';

const REDACTED = '[REDACTED]';
const PEM_BEGIN = /-----BEGIN [A-Z0-9 ]{0,64}PRIVATE KEY-----/;
const PEM_END = /-----END [A-Z0-9 ]{0,64}PRIVATE KEY-----/;

const rules: ReadonlyArray<readonly [RegExp, string]> = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, REDACTED],
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*$/g, REDACTED],
  [/\b([Bb]earer)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${REDACTED}`],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
  [/\bsk-(?:ant-)?[A-Za-z0-9._-]{16,}\b/g, REDACTED],
  [/\baid_[a-f0-9]{32,}\b/g, REDACTED],
  [/\bst\.[a-f0-9]{24,}\.[a-f0-9]{32,}\b/g, REDACTED],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  [
    /\b((?:access[_-]?key|api[_-]?key|apikey|client[_-]?secret|secret|password|passwd|auth[_-]?token|token)["']?[:=]["']?)[^\s"'&,}]{4,}/gi,
    `$1${REDACTED}`,
  ],
];

/** Defense-in-depth for bounded output that may enter local evidence or remote telemetry. */
export function redactSecrets<T>(value: T): T {
  if (typeof value !== 'string') return value;
  let output: string = value;
  for (const [pattern, replacement] of rules) output = output.replace(pattern, replacement);
  return output as unknown as T;
}

const StreamingRedactorOptionsSchema = z.strictObject({
  maxBufferedChars: z.number().int().min(128).max(1_048_576).default(16_384),
});

export interface StreamingSecretRedactor {
  /** Accepts an arbitrary text fragment and returns the safe output now available. */
  write(chunk: string): string;
  /** Flushes the final unterminated record. Must be called exactly once. */
  end(): string;
  /** Exposed for bounded-memory assertions and operational metrics. */
  readonly bufferedChars: number;
}

/**
 * Creates a bounded redactor for process output whose credentials may cross
 * arbitrary chunk boundaries. Complete logical lines are held until their
 * secret shape is known. An overlong line is conservatively replaced rather
 * than partially emitted, so the memory ceiling cannot turn into a leak.
 */
export function createStreamingSecretRedactor(options: { readonly maxBufferedChars?: number } = {}): StreamingSecretRedactor {
  const { maxBufferedChars } = StreamingRedactorOptionsSchema.parse(options);
  let pending = '';
  let insidePem = false;
  let discardOverlongRecord = false;
  let finished = false;

  const redactRecord = (record: string): string => {
    if (insidePem) {
      const end = PEM_END.exec(record);
      if (!end) return '';
      insidePem = false;
      return redactRecord(record.slice((end.index ?? 0) + end[0].length));
    }

    const begin = PEM_BEGIN.exec(record);
    if (!begin) return redactSecrets(record);
    const prefix = redactSecrets(record.slice(0, begin.index));
    const remainder = record.slice(begin.index + begin[0].length);
    const end = PEM_END.exec(remainder);
    if (end) return `${prefix}${REDACTED}${redactRecord(remainder.slice((end.index ?? 0) + end[0].length))}`;
    insidePem = true;
    const lineEnding = record.endsWith('\r\n') ? '\r\n' : record.endsWith('\n') ? '\n' : '';
    return `${prefix}${REDACTED}${lineEnding}`;
  };

  const write = (input: string): string => {
    if (finished) throw new Error('streaming secret redactor is already finished');
    const chunk = z.string().parse(input);
    let output = '';
    let offset = 0;
    while (offset < chunk.length) {
      if (discardOverlongRecord) {
        const newline = chunk.indexOf('\n', offset);
        if (newline < 0) return output;
        output += '\n';
        discardOverlongRecord = false;
        offset = newline + 1;
        continue;
      }

      const newline = chunk.indexOf('\n', offset);
      const available = maxBufferedChars - pending.length;
      const wanted = (newline < 0 ? chunk.length : newline + 1) - offset;
      if (wanted > available) {
        pending = '';
        output += REDACTED;
        discardOverlongRecord = true;
        continue;
      }

      pending += chunk.slice(offset, offset + wanted);
      offset += wanted;
      if (newline >= 0) {
        output += redactRecord(pending);
        pending = '';
      }
    }
    return output;
  };

  return {
    write,
    end() {
      if (finished) throw new Error('streaming secret redactor is already finished');
      finished = true;
      if (discardOverlongRecord) {
        discardOverlongRecord = false;
        return '';
      }
      const output = redactRecord(pending);
      pending = '';
      return output;
    },
    get bufferedChars() { return pending.length; },
  };
}
