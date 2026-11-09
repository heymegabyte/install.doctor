import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCT_IDENTITY,
  assertCapabilityClaim,
  canonicalIdentity,
  productStatusPayload,
  renderProductStatusMarkdown,
  validateProductIdentityRegistry
} from '../dist/product-identity.js';

function registry() {
  return structuredClone(PRODUCT_IDENTITY);
}

test('defines every Desktop Tools identity boundary in one valid registry', () => {
  assert.deepEqual(validateProductIdentityRegistry(PRODUCT_IDENTITY), PRODUCT_IDENTITY);
  assert.equal(canonicalIdentity('desktop-tools-product').value, 'Desktop Tools');
  assert.equal(canonicalIdentity('desktop-tools-executable').value, 'desktop-tools');
  assert.equal(canonicalIdentity('desktop-tools-profile-domain').value, '{profile}.desktop.tools');
});

test('rejects duplicate and Unicode-ambiguous names', () => {
  const duplicate = registry();
  duplicate.legacy.push({ ...duplicate.legacy[0] });
  assert.throws(() => validateProductIdentityRegistry(duplicate), /duplicate or ambiguous/i);

  const ambiguous = registry();
  ambiguous.legacy.push({
    kind: 'product',
    value: 'Ｄｅｓｋｔｏｐ Ｔｏｏｌｓ',
    owner: 'desktop-tools',
    mapsTo: 'desktop-tools-product',
    disposition: 'retired',
    removeAfter: null
  });
  assert.throws(() => validateProductIdentityRegistry(ambiguous), /duplicate or ambiguous/i);
});

test('rejects unowned names and ambiguous legacy mappings', () => {
  const unowned = registry();
  delete unowned.legacy[0].owner;
  assert.throws(() => validateProductIdentityRegistry(unowned), /owner/i);

  const missingTarget = registry();
  missingTarget.legacy[0].mapsTo = 'missing-product';
  assert.throws(() => validateProductIdentityRegistry(missingTarget), /unknown target/i);

  const wrongKind = registry();
  wrongKind.legacy[0].mapsTo = 'desktop-tools-executable';
  assert.throws(() => validateProductIdentityRegistry(wrongKind), /kind does not match/i);
});

test('rejects unknown fields and incomplete canonical registries', () => {
  assert.throws(
    () => validateProductIdentityRegistry({ ...registry(), undocumentedAlias: 'aid2' }),
    /unrecognized/i
  );

  const incomplete = registry();
  incomplete.canonical = incomplete.canonical.filter(entry => entry.kind !== 'domain-template');
  assert.throws(() => validateProductIdentityRegistry(incomplete), /missing canonical identity kinds/i);
});

test('prevents capability claims from exceeding their evidence', () => {
  assert.doesNotThrow(() => assertCapabilityClaim('device-authorization', 'implemented-unverified'));
  assert.throws(
    () => assertCapabilityClaim('device-authorization', 'verified-live'),
    /exceeds evidence/i
  );
  assert.throws(
    () => assertCapabilityClaim('agent-provisioning-session', 'verified-live'),
    /exceeds evidence/i
  );
  assert.doesNotThrow(() => assertCapabilityClaim('product-identity', 'implemented-unverified'));
});

test('requires evidence appropriate to every capability status', () => {
  const invalid = registry();
  invalid.capabilities[0].status = 'verified-live';
  assert.throws(() => validateProductIdentityRegistry(invalid), /runtime evidence/i);

  const duplicate = registry();
  duplicate.capabilities.push({ ...duplicate.capabilities[0] });
  assert.throws(() => validateProductIdentityRegistry(duplicate), /capability ids must be unique/i);
});

test('generates capability and migration status from the registry', () => {
  const markdown = renderProductStatusMarkdown();
  assert.match(markdown, /Desktop Tools capability and migration status/);
  assert.match(markdown, /Cross-device authorization \| `implemented-unverified`/);
  assert.match(markdown, /`app\.install\.doctor` \| `desktop\.tools` \| `migration-only`/);
  assert.match(markdown, /<br \/>/);
  assert.doesNotMatch(markdown, /<br>/);
  assert.doesNotMatch(markdown, /Cross-device authorization \| `verified-live`/);
});

test('serves a public status payload without a second capability ledger', () => {
  const payload = productStatusPayload();
  assert.equal(payload.product, 'Desktop Tools');
  assert.equal(payload.capabilities.find(item => item.id === 'device-authorization').status, 'implemented-unverified');
  assert.deepEqual(
    payload.migrations.find(item => item.legacy === 'aid'),
    {
      kind: 'executable',
      legacy: 'aid',
      canonical: 'desktop-tools',
      disposition: 'compatibility-alias',
      removeAfter: null
    }
  );
});
