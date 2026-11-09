import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmod, chown, copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { deriveBoundNormalizedPlan } from '../dist/engine.js';
import { composeNativeDebianPackageSlice } from '../dist/native-debian-composition.js';
import { derivePrivilegedBrokerAuthority } from '../dist/privileged-broker-derivation.js';
import { runPrivilegedBrokerController } from '../dist/privileged-broker-controller.js';
import { brokerApprovalAuditDigest, brokerApprovalSemanticDigest,
  brokerApprovalSigningBytes } from '../../aid-core/dist/broker-approval-contracts.js';

const helperSource = process.env.DESKTOP_TOOLS_PRIVILEGED_BROKER_TEST_BINARY;
const clientModuleSource = process.env.DESKTOP_TOOLS_PRIVILEGED_BROKER_CLIENT_TEST_MODULE;
const enabled = process.platform === 'linux' && process.geteuid?.() === 0 && helperSource && clientModuleSource;
const hash = value => createHash('sha256').update(value).digest('hex');
const fileHash = async path => hash(await readFile(path));
const compare = (left, right) => left.localeCompare(right, undefined, { numeric: true });

function descriptor() {
  return {
    schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: 'tree',
    platform: { os: 'linux', arch: 'x64' }, package: { name: 'tree', version: '2.1.0-1', architecture: 'amd64' },
    artifact: { id: 'tree-deb', sha256: hash('tree'), sizeBytes: 4, mediaType: 'application/vnd.debian.binary-package' },
    distro: { id: 'debian', versionId: '12', codename: 'bookworm' },
    repository: { repositoryOrigin: 'https://deb.debian.org/debian', suite: 'bookworm', component: 'main' },
    metadataProof: {
      inRelease: { artifactId: 'release', path: 'dists/bookworm/InRelease', sha256: hash('release'), sizeBytes: Buffer.byteLength('release'),
        signedAt: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z', maximumDateAgeSeconds: null,
        signingKeyFingerprint: 'A'.repeat(40), keyring: { artifactId: 'keyring', sha256: hash('keyring'), sizeBytes: Buffer.byteLength('keyring'), mediaType: 'application/vnd.gnupg.keyring' } },
      packagesIndex: { artifactId: 'packages', path: 'dists/bookworm/main/binary-amd64/Packages.xz', sha256: hash('packages'), sizeBytes: Buffer.byteLength('packages'), architecture: 'amd64' },
      packageStanza: { filename: 'pool/main/t/tree/tree_2.1.0-1_amd64.deb', sha256: hash('tree'), sizeBytes: 4,
        depends: 'libc6 (>= 2.34)', preDepends: null, essential: 'no', multiArch: 'foreign' },
    }, dependencyClosure: { depends: [], preDepends: [] }, affectedServiceUnits: [], conffiles: [],
    maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' },
  };
}

async function exactInput(runId, authorityRoot, helperPath, runtimePath, workerPath) {
  const payload = descriptor();
  const desired = { schemaVersion: 1, revision: 'controller-test', hostId: 'controller-host', packages: ['tree'], services: [], consents: [], offline: false };
  const composed = composeNativeDebianPackageSlice({ descriptor: payload,
    target: { distroId: 'debian', versionId: '12', codename: 'bookworm', architecture: 'amd64' },
    installedWitnesses: [{ kind: 'preexisting-witness', manager: 'dpkg', packageName: 'libc6', version: '2.36-9', architecture: 'amd64', status: 'installed', healthy: true, held: false }],
    desiredState: desired, legacyPackages: ['tree'], compareDebianVersions: compare });
  const now = new Date();
  const facts = { schemaVersion: 1, hostId: 'controller-host', collectedAt: now.toISOString(), os: 'linux', osVersion: '12', arch: 'x64', environment: 'native',
    roles: ['server'], packageManagers: ['dpkg'], capabilities: ['network-namespace'] };
  const plan = await deriveBoundNormalizedPlan({ tasks: [composed.task], selectedTaskIds: [composed.task.id],
    executionPolicy: { maxConcurrency: 1, resourceLimits: { cpu: 2, memoryMiB: 1024, networkConcurrency: 0 } } },
  facts, composed.desiredState, 'controller-release', now.toISOString());
  const artifact = (artifactId, value, file) => ({ artifactId, url: `https://desktop.tools/${artifactId}`,
    sourcePath: join(authorityRoot, file), sha256: hash(value), sizeBytes: Buffer.byteLength(value), mode: '0600' });
  return derivePrivilegedBrokerAuthority({
    schemaVersion: 1, approvalMode: 'trusted-local', runId, approvedPlanDigest: plan.digest, plan, operations: composed.operations.operations,
    desiredState: composed.desiredState, hostFacts: facts, descriptor: payload,
    releaseProof: { manifestPath: join(authorityRoot, 'manifest'), signaturePath: join(authorityRoot, 'manifest.sig'),
      catalogPath: join(authorityRoot, 'catalog.json'), manifestSha256: '1'.repeat(64),
      trust: { keyId: 'controller-test-release', publicKey: `ssh-ed25519 ${'A'.repeat(43)}=` } },
    artifacts: [artifact('keyring', 'keyring', 'keyring'), artifact('packages', 'packages', 'packages'),
      artifact('release', 'release', 'inrelease'), artifact('tree-deb', 'tree', 'tree.deb')],
    transactionRoot: `/var/lib/desktop-tools/transactions/${runId}`, enrolledUid: 1000, socketGid: 0,
    helperPath, helperDigest: await fileHash(helperPath), runtimePath, runtimeDigest: await fileHash(runtimePath),
    workerPath, workerDigest: await fileHash(workerPath), socketPath: `/run/desktop-tools/broker/${runId}/broker.sock`,
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), operationTimeoutMs: 5_000,
  }).controllerInput;
}

async function absent(path) {
  await assert.rejects(lstat(path), error => error?.code === 'ENOENT');
}

async function prepareRuntimeParents(enrolledGid) {
  await mkdir('/run/desktop-tools', { recursive: true, mode: 0o750 });
  await mkdir('/run/desktop-tools/authority', { recursive: true, mode: 0o711 });
  await mkdir('/run/desktop-tools/broker', { recursive: true, mode: 0o750 });
  await Promise.all([
    chown('/run/desktop-tools', 0, enrolledGid), chmod('/run/desktop-tools', 0o750),
    chown('/run/desktop-tools/authority', 0, 0), chmod('/run/desktop-tools/authority', 0o711),
    chown('/run/desktop-tools/broker', 0, enrolledGid), chmod('/run/desktop-tools/broker', 0o750),
  ]);
}

async function exerciseController(t, suffix, authorize) {
  const runId = `controller-test-${process.pid}-${suffix}`;
  const authorityRoot = `/run/desktop-tools/authority/${runId}`;
  const socketRoot = `/run/desktop-tools/broker/${runId}`;
  const helperPath = join(authorityRoot, 'desktop-tools-privileged-broker');
  const runtimePath = join(authorityRoot, 'runtime');
  const workerPath = join(authorityRoot, 'worker.mjs');
  await mkdir(authorityRoot, { recursive: true, mode: 0o700 });
  await mkdir(socketRoot, { recursive: true, mode: 0o710 });
  await chmod(authorityRoot, 0o711);
  await Promise.all([copyFile(helperSource, helperPath), copyFile('/bin/sh', runtimePath), writeFile(workerPath, 'process.exit(1);\n')]);
  await Promise.all([chmod(helperPath, 0o555), chmod(runtimePath, 0o555), chmod(workerPath, 0o400)]);
  await Promise.all([chown(helperPath, 0, 0), chown(runtimePath, 0, 0), chown(workerPath, 0, 0), chown(socketRoot, 0, 0)]);
  t.after(async () => {
    await rm(socketRoot, { recursive: true, force: true });
    await rm(authorityRoot, { recursive: true, force: true });
  });
  const input = await exactInput(runId, authorityRoot, helperPath, runtimePath, workerPath);
  const { controllerInput, options = {} } = await authorize(input);
  const result = await runPrivilegedBrokerController(controllerInput, {
    ...options,
    onReady: () => process.emit('SIGTERM'),
  });
  assert.equal(result.exitCode, 0);
  await absent(controllerInput.socketPath);
  await absent(`${controllerInput.socketPath}.starting`);
  await absent(`/run/desktop-tools/privileged/grants/${controllerInput.grant.grantId}.json`);
  await absent(`/run/desktop-tools/privileged/authorities/${controllerInput.grant.grantId}.json`);
}

async function command(file, arguments_, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    const stdout = []; const stderr = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 && signal === null
      ? resolve(Buffer.concat(stdout).toString('utf8'))
      : reject(new Error(`${file} failed (${signal ?? code}): ${Buffer.concat(stderr).toString('utf8').slice(0, 512)}`)));
  });
}

test('Linux root controller admits an enrolled UID through the real sealed-FD broker transport',
  { skip: !enabled, timeout: 20_000 }, async t => {
  const identity = await command('/usr/bin/id', ['-g', '1000']).catch(() => '');
  if (!identity.trim()) return t.skip('fixture requires enrolled uid 1000');
  const enrolledGid = Number(identity.trim());
  await prepareRuntimeParents(enrolledGid);
  const runId = `controller-transport-${process.pid}`;
  const authorityRoot = `/run/desktop-tools/authority/${runId}`;
  const socketRoot = `/run/desktop-tools/broker/${runId}`;
  const helperPath = join(authorityRoot, 'desktop-tools-privileged-broker');
  const runtimePath = join(authorityRoot, 'runtime');
  const workerPath = join(authorityRoot, 'worker.mjs');
  const clientModulePath = join('/tmp', `${runId}-client.mjs`);
  const payloadPath = join('/tmp', `${runId}.deb`);
  await mkdir(authorityRoot, { recursive: true, mode: 0o700 });
  await mkdir(socketRoot, { recursive: true, mode: 0o710 });
  await chmod(authorityRoot, 0o711);
  await Promise.all([copyFile(helperSource, helperPath), copyFile(process.execPath, runtimePath),
    copyFile(clientModuleSource, clientModulePath)]);
  const worker = `
import { createHash } from 'node:crypto';
import { fstatSync, writeSync } from 'node:fs';
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
const envelope=JSON.parse(Buffer.concat(chunks)); const request=envelope.request;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,canonical(child)])):value;
const digest=value=>createHash('sha256').update('desktop-tools:privileged-broker:v1\\0').update(JSON.stringify(canonical(value))).digest('hex');
const payload=fstatSync(3); if(!payload.isFile()||payload.nlink!==0) process.exit(2);
const statuses={check:'needed',apply:'applied',verify:'verified'};
const receipt={schemaVersion:1,hostId:request.hostId,releaseId:request.releaseId,runId:request.runId,planDigest:request.planDigest,grantId:request.grantId,grantDigest:request.grantDigest,taskId:request.taskId,operationId:request.operationId,phase:request.phase,nonce:request.nonce,payloadSha256:request.payload.sha256,requestDigest:digest(request),status:statuses[request.phase],fenceDigest:'f'.repeat(64),completedAt:new Date().toISOString()};
writeSync(4,Buffer.from(JSON.stringify(receipt)));
`;
  await Promise.all([writeFile(workerPath, worker), writeFile(payloadPath, 'tree')]);
  await Promise.all([chmod(helperPath, 0o555), chmod(runtimePath, 0o555), chmod(workerPath, 0o400),
    chmod(clientModulePath, 0o444), chmod(payloadPath, 0o400)]);
  await Promise.all([chown(helperPath, 0, 0), chown(runtimePath, 0, 0), chown(workerPath, 0, 0),
    chown(clientModulePath, 0, 0), chown(socketRoot, 0, enrolledGid), chown(payloadPath, 1000, enrolledGid)]);
  t.after(async () => {
    await rm(socketRoot, { recursive: true, force: true }); await rm(authorityRoot, { recursive: true, force: true });
    await rm(payloadPath, { force: true }); await rm(clientModulePath, { force: true });
  });
  const input = await exactInput(runId, authorityRoot, helperPath, runtimePath, workerPath);
  input.socketGid = enrolledGid;
  const clientModule = pathToFileURL(clientModulePath).href;
  const clientScript = `import{open,readFile}from'node:fs/promises';import{createPrivilegedBrokerNativeRuntime as create}from'${clientModule}';const input=JSON.parse(await readFile(process.argv[1],'utf8'));const payload=process.argv[2];const runtime=create(input.config);const authority=phase=>({operation:{kind:'native-package',effectClass:'native-package',action:phase,packageKey:'tree',payloadArtifactId:'tree-deb'},rootDescriptor:{packageKey:'tree',artifact:{sha256:'${hash('tree')}',sizeBytes:4}},packages:[],installedWitnesses:[],withPayload:async(_key,use)=>{const handle=await open(payload,'r');try{return await use(handle)}finally{await handle.close()}},context:undefined});if(await runtime.check(authority('check'))!=='needed')process.exit(3);await runtime.apply(authority('apply'));if(await runtime.verify(authority('verify'))!=='verified')process.exit(4);`;
  const clientInputPath = join('/tmp', `${runId}.json`);
  const clientConfig = { helperPath, socketPath: input.socketPath, hostId: input.grant.hostId, releaseId: input.grant.releaseId,
    runId: input.grant.runId, planDigest: input.grant.planDigest, taskId: input.grant.operations[0].taskId, grant: input.grant };
  await writeFile(clientInputPath, JSON.stringify({ config: clientConfig }), { mode: 0o400 }); await chown(clientInputPath, 1000, enrolledGid);
  t.after(() => rm(clientInputPath, { force: true }));
  const result = await runPrivilegedBrokerController(input, { confirmation: { confirm: async () => true }, onReady: async () => {
    await command('/usr/bin/setpriv', [`--reuid=1000`, `--regid=${enrolledGid}`, '--clear-groups', process.execPath,
      '--input-type=module', '--eval', clientScript, clientInputPath, payloadPath], { env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } });
  } });
  assert.equal(result.exitCode, 0);
  await absent(input.socketPath);
});

test('Linux root controller serializes process-global broker lifecycles',
  { skip: !enabled, timeout: 20_000 }, async t => {
  await t.test('publishes only a listening broker and retires all volatile authority', async localTest => {
    await exerciseController(localTest, 'local', controllerInput => ({ controllerInput,
      options: { confirmation: { confirm: async () => true } } }));
  });

  await t.test('accepts exact signed-device authority without local confirmation', async deviceTest => {
    await exerciseController(deviceTest, 'device', async controllerInput => {
    const signer = generateKeyPairSync('ed25519');
    const signerKeyId = 'controller-device-key-1';
    const unsigned = { schemaVersion: 1, kind: 'desktop-tools-broker-approval', signerKeyId,
      signatureDomain: 'desktop-tools-broker-approval-v1', approvalId: `approval-${controllerInput.grant.runId}`,
      authorizationId: 'authorization-controller', ownerDecisionId: 'decision-controller', ownerActorId: 'owner-controller',
      tenantId: 'tenant-controller', profileId: 'profile-controller', profileRevisionDigest: hash('profile'),
      deviceCredentialId: 'credential-controller', deviceFingerprint: hash('device'), runIntentId: 'intent-controller',
      grant: controllerInput.grant,
      grantDigest: await brokerApprovalSemanticDigest('desktop-tools:privileged-broker:v1', controllerInput.grant),
      delegationDigest: '', revocationEpoch: 1,
      approvedAt: new Date(Date.parse(controllerInput.grant.issuedAt) + 1).toISOString(),
      expiresAt: new Date(Date.parse(controllerInput.grant.expiresAt) - 1).toISOString() };
    const projection = { schemaVersion: 1, kind: 'desktop-tools-broker-approval-signer-delegation', keyId: signerKeyId,
      algorithm: 'Ed25519', signatureDomain: 'desktop-tools-broker-approval-v1', product: 'desktop-tools',
      releaseId: controllerInput.grant.releaseId, channel: 'stable',
      publicKeySpki: signer.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      notBefore: controllerInput.grant.issuedAt, notAfter: controllerInput.grant.expiresAt,
      maximumApprovalLifetimeSeconds: 600, revocationEpoch: 1 };
    const sorted = value => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sorted(entry)]))
      : Array.isArray(value) ? value.map(sorted) : value;
    const delegationDigest = hash(`desktop-tools:broker-approval-signer-delegation:v1\0${JSON.stringify(sorted(projection))}`);
    const bytes = Buffer.from(`${JSON.stringify(sorted({ ...projection, delegationDigest }))}\n`);
    unsigned.delegationDigest = delegationDigest;
    const deviceApproval = { ...unsigned,
      signature: sign(null, brokerApprovalSigningBytes(unsigned), signer.privateKey).toString('base64url'),
      auditDigest: await brokerApprovalAuditDigest(unsigned) };
    const brokerApprovalDelegationPath = join(dirname(controllerInput.helperPath), 'broker-approval-signer-delegation.json');
    await writeFile(brokerApprovalDelegationPath, bytes, { mode: 0o400 });
    await chown(brokerApprovalDelegationPath, 0, 0);
      return { controllerInput: { ...controllerInput, approvalMode: 'signed-device', deviceApproval, brokerApprovalDelegationPath,
        brokerApprovalDelegationDigest: hash(bytes), brokerApprovalMinimumRevocationEpoch: 1 } };
    });
  });
});
