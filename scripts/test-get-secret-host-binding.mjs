#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../home/dot_local/bin/executable_get-secret', import.meta.url), 'utf8');
assert.match(source, /config\.secretPath/);
assert.match(source, /config\.hostId/);
assert.match(source, /com\.heymegabyte\.infisical-universal-auth-client-secret/);
assert.match(source, /universal-auth\/login/);
assert.match(source, /config\.clientId/);
assert.match(source, /config\.secretPath !== '\/'/);
assert.match(source, /stat\.mode & 0o077/);
assert.match(source, /curl', \['--config', '-'\]/);
assert.doesNotMatch(source, /--token/);
assert.doesNotMatch(source, /service-token/);
assert.doesNotMatch(source, /process\.cwd\(\).*\.infisical\.json/s);
assert.doesNotMatch(source, /const secretPath = `\/hosts\/\$\{hostname\}`/);

const template = readFileSync(new URL('../home/private_dot_infisical.json.tmpl', import.meta.url), 'utf8');
assert.match(template, /macos\.megabyte\.space/);
assert.match(template, /ubuntu\.megabyte\.space/);
assert.match(template, /b9f92958-bd90-4e0a-a464-c51db5fa6d52/);
assert.match(template, /fa93b35d-7cf1-4e33-bd3f-9712f503a382/);
assert.match(template, /"secretPath": "\/"/);
console.log('get-secret host binding tests: PASS');
