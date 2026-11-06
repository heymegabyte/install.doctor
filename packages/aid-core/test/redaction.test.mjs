import assert from 'node:assert/strict';
import test from 'node:test';
import { createStreamingSecretRedactor, redactSecrets } from '../dist/redaction.js';

test('shared output redaction removes known credentials and explicit secret assignments', () => {
  const input = 'Bearer abcdefghijklmnop token=supersecret ghp_abcdefghijklmnopqrstuvwxyz';
  const output = redactSecrets(input);
  assert.equal(output.includes('abcdefghijklmnop'), false);
  assert.equal(output.includes('supersecret'), false);
  assert.equal(output.includes('ghp_abcdefghijklmnopqrstuvwxyz'), false);
  assert.match(output, /Bearer \[REDACTED\]/);
  assert.match(output, /token=\[REDACTED\]/);
});

test('shared output redaction is deterministic, idempotent, and preserves ordinary prose', () => {
  const input = 'the secret: it works; installation completed';
  assert.equal(redactSecrets(redactSecrets(input)), input);
  assert.equal(redactSecrets(42), 42);
});

function stream(chunks, options) {
  const redactor = createStreamingSecretRedactor(options);
  return chunks.map(chunk => redactor.write(chunk)).join('') + redactor.end();
}

test('streaming redaction catches an assignment split at every chunk boundary', () => {
  const input = 'before token=supersecretvalue after\n';
  for (let split = 0; split <= input.length; split += 1) {
    const output = stream([input.slice(0, split), input.slice(split)]);
    assert.equal(output.includes('supersecretvalue'), false, `split ${split}`);
    assert.equal(output, 'before token=[REDACTED] after\n', `split ${split}`);
  }
});

test('streaming redaction removes CRLF private keys split one character at a time', () => {
  const privateKey = [
    'prefix\r\n',
    '-----BEGIN OPENSSH PRIVATE KEY-----\r\n',
    'b3BlbnNzaC1rZXktdjEAAAAA-secret-body\r\n',
    '-----END OPENSSH PRIVATE KEY-----\r\n',
    'suffix\r\n',
  ].join('');
  const output = stream([...privateKey]);
  assert.equal(output.includes('secret-body'), false);
  assert.equal(output.includes('BEGIN OPENSSH'), false);
  assert.equal(output.includes('END OPENSSH'), false);
  assert.match(output, /^prefix\r\n\[REDACTED\]\r\n/);
  assert.match(output, /suffix\r\n$/);
});

test('streaming redaction fails closed for an unterminated private key', () => {
  const output = stream([
    'visible\n-----BEGIN RSA PRIV',
    'ATE KEY-----\nprivate-material',
    '-must-not-escape',
  ]);
  assert.equal(output.includes('private-material'), false);
  assert.equal(output.includes('must-not-escape'), false);
  assert.equal(output, 'visible\n[REDACTED]\n');
});

test('streaming redaction keeps bounded state and fails closed on oversized records', () => {
  const redactor = createStreamingSecretRedactor({ maxBufferedChars: 128 });
  let output = '';
  for (const chunk of ['ordinary-prefix-', 'x'.repeat(10_000), '-token=never-leak', '\nnext line\n']) {
    output += redactor.write(chunk);
    assert.ok(redactor.bufferedChars <= 128);
  }
  output += redactor.end();
  assert.equal(output.includes('never-leak'), false);
  assert.equal(output, '[REDACTED]\nnext line\n');
  assert.equal(redactor.bufferedChars, 0);
  assert.throws(() => redactor.write('late'), /already finished/);
  assert.throws(() => redactor.end(), /already finished/);
});

test('streaming options reject unknown and unsafe buffer settings', () => {
  assert.throws(() => createStreamingSecretRedactor({ maxBufferedChars: 127 }));
  assert.throws(() => createStreamingSecretRedactor({ maxBufferedChars: 256, unknown: true }));
});
