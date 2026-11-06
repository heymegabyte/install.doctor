import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';

import {
  DebianGpgvError,
  createDefaultDebianMetadataVerifier,
  extractInReleaseCleartext,
  parseGpgvValidSignature,
} from '../dist/debian-gpgv.js';

test('extractInReleaseCleartext handles CRLF and OpenPGP dash escaping', () => {
  const source = Buffer.from([
    '-----BEGIN PGP SIGNED MESSAGE-----',
    'Hash: SHA256',
    '',
    'Suite: stable',
    '- -dash-prefixed',
    '',
    '-----BEGIN PGP SIGNATURE-----',
    '',
    'c2ln',
    '=abcd',
    '-----END PGP SIGNATURE-----',
    '',
  ].join('\r\n'));
  assert.equal(extractInReleaseCleartext(source).toString(), 'Suite: stable\n-dash-prefixed\n\n');
});

test('extractInReleaseCleartext rejects malformed envelopes and unsafe controls', () => {
  for (const source of [
    'not signed',
    '-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nbody\n',
    '-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nbody\rbroken\n-----BEGIN PGP SIGNATURE-----\n\nx\n-----END PGP SIGNATURE-----\n',
    '-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nbody\0\n-----BEGIN PGP SIGNATURE-----\n\nx\n-----END PGP SIGNATURE-----\n',
  ]) assert.throws(() => extractInReleaseCleartext(Buffer.from(source)), DebianGpgvError);
});

test('parseGpgvValidSignature requires exactly one full fingerprint', () => {
  const fingerprint = '0123456789ABCDEF0123456789ABCDEF01234567';
  assert.equal(parseGpgvValidSignature(Buffer.from(`[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG ${fingerprint} 2026-01-01 0 4 0 1 10 00 ${fingerprint}\n`)), fingerprint);
  assert.throws(() => parseGpgvValidSignature(Buffer.from('')), /exactly one VALIDSIG/);
  assert.throws(() => parseGpgvValidSignature(Buffer.from('[GNUPG:] VALIDSIG short 2026\n')), /exactly one VALIDSIG/);
  assert.throws(() => parseGpgvValidSignature(Buffer.from(`[GNUPG:] VALIDSIG ${fingerprint} x\n[GNUPG:] VALIDSIG ${fingerprint} x\n`)), /exactly one VALIDSIG/);
  assert.throws(() => parseGpgvValidSignature(Buffer.from(`[GNUPG:] VALIDSIG short x\n[GNUPG:] VALIDSIG ${fingerprint} x\n`)), /exactly one VALIDSIG/);
  assert.throws(() => parseGpgvValidSignature(Buffer.from(`[GNUPG:] BADSIG bad\n[GNUPG:] VALIDSIG ${fingerprint} x\n`)), /invalid.*signature/);
  assert.throws(() => parseGpgvValidSignature(Buffer.from(`[GNUPG:] EXPKEYSIG expired\n[GNUPG:] VALIDSIG ${fingerprint} x\n`)), /expired.*signature/);
});

test('default verifier bounded decompressor accepts gzip and rejects trailing bytes and bombs', async () => {
  const verifier = createDefaultDebianMetadataVerifier({
    keyring: { kind: 'path', absolutePath: '/already-verified/keyring.gpg' },
    maximumDecompressedBytes: 64,
  });
  const compressed = gzipSync(Buffer.from('Package: example\n'));
  assert.equal((await verifier.decompressPackages?.('Packages.gz', compressed)).toString(), 'Package: example\n');
  await assert.rejects(
    verifier.decompressPackages?.('Packages.gz', Buffer.concat([compressed, Buffer.from('junk')])),
    /decompression failed/,
  );
  await assert.rejects(
    verifier.decompressPackages?.('Packages.gz', gzipSync(Buffer.alloc(65, 0x61))),
    /output exceeded/,
  );
  await assert.rejects(verifier.decompressPackages?.('Packages.bz2', compressed), /unsupported Packages compression/);
});

test('path keyring authority must be explicit and absolute', () => {
  assert.throws(() => createDefaultDebianMetadataVerifier({
    keyring: { kind: 'path', absolutePath: 'keyring.gpg' },
  }), /absolute/);
});
