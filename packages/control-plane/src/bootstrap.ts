import { z } from 'zod';
import { releasePolicy, ReleaseProduct } from './release-policy.ts';

const BootstrapReleaseConfig = z.strictObject({
  product: ReleaseProduct.default('legacy-install-doctor'),
  manifestUrl: z.string().url(),
  signatureUrl: z.string().url(),
  signerIdentity: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  signerPublicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
  profile: z.strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/),
    slug: z.string().regex(/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,61}[a-z0-9]$/),
    revision: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
  }).optional(),
}).superRefine((config, context) => {
  const policy = releasePolicy(config.product);
  const manifestUrl = new URL(config.manifestUrl);
  const signatureUrl = new URL(config.signatureUrl);
  const manifestMatch = manifestUrl.pathname.match(
    /^\/releases\/([a-z0-9][a-z0-9._-]{0,127})\/manifest$/,
  );
  const signatureMatch = signatureUrl.pathname.match(
    /^\/releases\/([a-z0-9][a-z0-9._-]{0,127})\/manifest\.sig$/,
  );
  if (
    manifestUrl.origin !== policy.origin
    || signatureUrl.origin !== policy.origin
    || manifestUrl.search || manifestUrl.hash || signatureUrl.search || signatureUrl.hash
    || !manifestMatch || !signatureMatch || manifestMatch[1] !== signatureMatch[1]
  ) {
    context.addIssue({
      code: 'custom',
      path: ['manifestUrl'],
      message: 'manifest and signature URLs must bind the same immutable release identifier',
    });
  }
  if (config.product !== 'desktop-tools' && config.profile) {
    context.addIssue({ code: 'custom', path: ['profile'], message: 'profiles are valid only for Desktop Tools' });
  }
});

export type BootstrapReleaseConfig = z.infer<typeof BootstrapReleaseConfig>;

export function parseBootstrapReleaseConfig(input: unknown): BootstrapReleaseConfig {
  return BootstrapReleaseConfig.parse(input);
}

/**
 * Render the deliberately small stage-zero launcher. It trusts only the
 * repository-configured SSHSIG identity and a detached signature over the exact
 * manifest bytes. The manifest may select a release; it may not select its own
 * verification key.
 */
export function renderBootstrap(configInput: unknown): string {
  const config = parseBootstrapReleaseConfig(configInput);
  const policy = releasePolicy(config.product);
  const expectedReleaseId = new URL(config.manifestUrl).pathname.split('/')[2];
  const literal = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  return `#!/usr/bin/env bash
# ${policy.origin}/start — signed release bootstrap
set -euo pipefail
umask 077

readonly MANIFEST_URL=${literal(config.manifestUrl)}
readonly SIGNATURE_URL=${literal(config.signatureUrl)}
readonly SIGNER_ID=${literal(config.signerIdentity)}
readonly SIGNER_KEY=${literal(config.signerPublicKey)}
readonly EXPECTED_RELEASE_ID=${literal(expectedReleaseId)}
readonly EXPECTED_MANIFEST_SCHEMA=${literal(config.product === 'desktop-tools' ? '8' : '5')}
readonly EXPECTED_PRODUCT_ID=${literal(config.product === 'desktop-tools' ? 'desktop-tools' : '')}
readonly DESKTOP_TOOLS_PROFILE_ID=${literal(config.profile?.id ?? '')}
readonly DESKTOP_TOOLS_PROFILE_SLUG=${literal(config.profile?.slug ?? '')}
readonly DESKTOP_TOOLS_PROFILE_REVISION=${literal(config.profile?.revision ?? '')}
readonly DESKTOP_TOOLS_PROFILE_DIGEST=${literal(config.profile?.digest ?? '')}
readonly RELEASE_ORIGIN=${literal(policy.origin)}
readonly SIGNATURE_NAMESPACE=${literal(policy.signatureNamespace)}
readonly MAX_MANIFEST_BYTES=16384
readonly MAX_SIGNATURE_BYTES=8192
readonly MAX_ARTIFACT_BYTES=8388608
readonly MAX_CATALOG_BYTES=8388608
readonly MAX_RUNTIME_BYTES=100663296
readonly MAX_OPENCODE_BYTES=167772160
readonly MAX_TOOLS_BYTES=33554432
readonly MAX_METADATA_BYTES=8388608
readonly MIN_ENGINE_NODE_MAJOR=22
readonly MAX_RELEASE_LIFETIME=604800
readonly APPROVED_PATH='/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

die() { printf '${policy.diagnosticName}: %s\\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required before installation; install it from your operating-system package manager"; }
size() { wc -c < "$1" | tr -d '[:space:]'; }
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else die 'sha256sum or shasum is required before installation'; fi
}
download() {
  local url="$1" destination="$2" limit="$3"
  case "$url" in "$RELEASE_ORIGIN"/releases/*) ;; *) die 'release URL is outside the approved HTTPS origin' ;; esac
  curl -q --fail --show-error --silent --proto '=https' --proto-redir '=https' --tlsv1.2 \\
    --max-redirs 0 --retry 2 --retry-all-errors --retry-delay 1 --connect-timeout 10 --max-time 60 \\
    --max-filesize "$limit" --output "$destination" "$url"
  [ "$(size "$destination")" -le "$limit" ] || die 'download exceeded its declared size limit'
}

detect_platform() {
  local kernel machine
  kernel="$(uname -s 2>/dev/null)" || die 'cannot identify the operating-system kernel'
  machine="$(uname -m 2>/dev/null)" || die 'cannot identify the machine architecture'
  case "$kernel:$machine" in
    Darwin:x86_64) printf '%s\\n' 'macos-x64' ;;
    Darwin:arm64) printf '%s\\n' 'macos-arm64' ;;
    Linux:x86_64) printf '%s\\n' 'linux-x64' ;;
    Linux:aarch64|Linux:arm64) printf '%s\\n' 'linux-arm64' ;;
    *) die "unsupported bootstrap platform: $kernel/$machine; use a documented supported macOS or Linux host" ;;
  esac
}

need curl
need ssh-keygen
need uname
BOOTSTRAP_PLATFORM="$(detect_platform)"
ssh_y_help="$(ssh-keygen -Y 2>&1 || true)"
case "$ssh_y_help" in *'ssh-keygen -Y verify'*) ;; *) die 'this ssh-keygen lacks SSHSIG support; install a current OpenSSH client' ;; esac

case "\${TMPDIR:-/tmp}" in /*) ;; *) die 'TMPDIR must be an absolute path' ;; esac
STAGE="$(mktemp -d "\${TMPDIR:-/tmp}/${policy.stagePrefix}.XXXXXXXX")" || die 'could not create private staging directory'
[ ! -L "$STAGE" ] || die 'refusing a symlink staging directory'
[ -O "$STAGE" ] || die 'staging directory is not owned by the current user'
chmod 0700 "$STAGE"
[ "$(find "$STAGE" -prune -perm -077 -print 2>/dev/null)" = '' ] || die 'staging directory is accessible to another user'
DOWNLOAD_PIDS=('')
cleanup() {
  local pid
  for pid in "\${DOWNLOAD_PIDS[@]}"; do [ -z "$pid" ] || kill "$pid" 2>/dev/null || true; done
  for pid in "\${DOWNLOAD_PIDS[@]}"; do [ -z "$pid" ] || wait "$pid" 2>/dev/null || true; done
  rm -rf -- "$STAGE"
}
on_signal() { trap - EXIT HUP INT TERM; cleanup; exit "$1"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

MANIFEST="$STAGE/manifest"
SIGNATURE="$STAGE/manifest.sig"
ALLOWED_SIGNERS="$STAGE/allowed_signers"
ARTIFACT="$STAGE/provision.sh"
ENGINE="$STAGE/${policy.engineFilename}"
CATALOG="$STAGE/catalog.json"
RUNTIME_ARCHIVE="$STAGE/node-runtime.tar.gz"
OPENCODE_ARCHIVE="$STAGE/opencode-runtime.tar.gz"
SUPERVISOR="$STAGE/desktop-tools-supervisor.mjs"
TOOLS="$STAGE/desktop-tools-tools.tar.gz"
SBOM="$STAGE/release.sbom.json"
PROVENANCE="$STAGE/release.provenance.json"
LICENSES="$STAGE/THIRD_PARTY_LICENSES.txt"
OPENCODE_LOCK="$STAGE/opencode.lock.json"
printf '${policy.diagnosticName}: fetching signed release metadata...\n' >&2
download "$MANIFEST_URL" "$MANIFEST" "$MAX_MANIFEST_BYTES" & DOWNLOAD_PIDS+=("$!")
download "$SIGNATURE_URL" "$SIGNATURE" "$MAX_SIGNATURE_BYTES" & DOWNLOAD_PIDS+=("$!")
download_failed=0
for pid in "\${DOWNLOAD_PIDS[@]}"; do [ -z "$pid" ] || if ! wait "$pid"; then download_failed=1; fi; done
DOWNLOAD_PIDS=('')
[ "$download_failed" -eq 0 ] || die 'signed release metadata download failed'
printf '%s %s\\n' "$SIGNER_ID" "$SIGNER_KEY" > "$ALLOWED_SIGNERS"
ssh-keygen -Y verify -f "$ALLOWED_SIGNERS" -I "$SIGNER_ID" -n "$SIGNATURE_NAMESPACE" -s "$SIGNATURE" < "$MANIFEST" >/dev/null \\
  || die 'release manifest signature verification failed'

schema_version= product_id= release_id= source_commit= created_at= expires_at= key_id= artifact_url= artifact_sha256= artifact_size= engine_url= engine_sha256= engine_size= catalog_url= catalog_sha256= catalog_size= launcher_url= launcher_sha256= launcher_size= engine_node_min= runtime_node_version= opencode_version=
supervisor_url= supervisor_sha256= supervisor_size= tools_url= tools_sha256= tools_size= sbom_url= sbom_sha256= sbom_size= provenance_url= provenance_sha256= provenance_size= licenses_url= licenses_sha256= licenses_size= opencode_lock_url= opencode_lock_sha256= opencode_lock_size=
runtime_macos_x64_url= runtime_macos_x64_sha256= runtime_macos_x64_size= runtime_macos_arm64_url= runtime_macos_arm64_sha256= runtime_macos_arm64_size=
runtime_linux_x64_url= runtime_linux_x64_sha256= runtime_linux_x64_size= runtime_linux_arm64_url= runtime_linux_arm64_sha256= runtime_linux_arm64_size=
opencode_macos_x64_url= opencode_macos_x64_sha256= opencode_macos_x64_size= opencode_macos_arm64_url= opencode_macos_arm64_sha256= opencode_macos_arm64_size=
opencode_linux_x64_url= opencode_linux_x64_sha256= opencode_linux_x64_size= opencode_linux_arm64_url= opencode_linux_arm64_sha256= opencode_linux_arm64_size=
debian_inrelease_url= debian_inrelease_sha256= debian_inrelease_size= debian_keyring_url= debian_keyring_sha256= debian_keyring_size=
debian_packages_url= debian_packages_sha256= debian_packages_size= debian_tree_url= debian_tree_sha256= debian_tree_size=
while IFS='=' read -r key value; do
  [ -n "$key" ] && [ -n "$value" ] || die 'release manifest contains an empty field'
  case "$key" in
    schema_version) [ -z "$schema_version" ] || die 'release manifest repeats schema_version'; schema_version="$value" ;;
    product_id) [ -z "$product_id" ] || die 'release manifest repeats product_id'; product_id="$value" ;;
    release_id) [ -z "$release_id" ] || die 'release manifest repeats release_id'; release_id="$value" ;;
    source_commit) [ -z "$source_commit" ] || die 'release manifest repeats source_commit'; source_commit="$value" ;;
    created_at) [ -z "$created_at" ] || die 'release manifest repeats created_at'; created_at="$value" ;;
    expires_at) [ -z "$expires_at" ] || die 'release manifest repeats expires_at'; expires_at="$value" ;;
    key_id) [ -z "$key_id" ] || die 'release manifest repeats key_id'; key_id="$value" ;;
    artifact_url) [ -z "$artifact_url" ] || die 'release manifest repeats artifact_url'; artifact_url="$value" ;;
    artifact_sha256) [ -z "$artifact_sha256" ] || die 'release manifest repeats artifact_sha256'; artifact_sha256="$value" ;;
    artifact_size) [ -z "$artifact_size" ] || die 'release manifest repeats artifact_size'; artifact_size="$value" ;;
    engine_url) [ -z "$engine_url" ] || die 'release manifest repeats engine_url'; engine_url="$value" ;;
    engine_sha256) [ -z "$engine_sha256" ] || die 'release manifest repeats engine_sha256'; engine_sha256="$value" ;;
    engine_size) [ -z "$engine_size" ] || die 'release manifest repeats engine_size'; engine_size="$value" ;;
    catalog_url) [ -z "$catalog_url" ] || die 'release manifest repeats catalog_url'; catalog_url="$value" ;;
    catalog_sha256) [ -z "$catalog_sha256" ] || die 'release manifest repeats catalog_sha256'; catalog_sha256="$value" ;;
    catalog_size) [ -z "$catalog_size" ] || die 'release manifest repeats catalog_size'; catalog_size="$value" ;;
    launcher_url) [ -z "$launcher_url" ] || die 'release manifest repeats launcher_url'; launcher_url="$value" ;;
    launcher_sha256) [ -z "$launcher_sha256" ] || die 'release manifest repeats launcher_sha256'; launcher_sha256="$value" ;;
    launcher_size) [ -z "$launcher_size" ] || die 'release manifest repeats launcher_size'; launcher_size="$value" ;;
    engine_node_min) [ -z "$engine_node_min" ] || die 'release manifest repeats engine_node_min'; engine_node_min="$value" ;;
    runtime_node_version) [ -z "$runtime_node_version" ] || die 'release manifest repeats runtime_node_version'; runtime_node_version="$value" ;;
    opencode_version) [ -z "$opencode_version" ] || die 'release manifest repeats opencode_version'; opencode_version="$value" ;;
    supervisor_url) [ -z "$supervisor_url" ] || die 'release manifest repeats supervisor_url'; supervisor_url="$value" ;;
    supervisor_sha256) [ -z "$supervisor_sha256" ] || die 'release manifest repeats supervisor_sha256'; supervisor_sha256="$value" ;;
    supervisor_size) [ -z "$supervisor_size" ] || die 'release manifest repeats supervisor_size'; supervisor_size="$value" ;;
    tools_url) [ -z "$tools_url" ] || die 'release manifest repeats tools_url'; tools_url="$value" ;;
    tools_sha256) [ -z "$tools_sha256" ] || die 'release manifest repeats tools_sha256'; tools_sha256="$value" ;;
    tools_size) [ -z "$tools_size" ] || die 'release manifest repeats tools_size'; tools_size="$value" ;;
    sbom_url) [ -z "$sbom_url" ] || die 'release manifest repeats sbom_url'; sbom_url="$value" ;;
    sbom_sha256) [ -z "$sbom_sha256" ] || die 'release manifest repeats sbom_sha256'; sbom_sha256="$value" ;;
    sbom_size) [ -z "$sbom_size" ] || die 'release manifest repeats sbom_size'; sbom_size="$value" ;;
    provenance_url) [ -z "$provenance_url" ] || die 'release manifest repeats provenance_url'; provenance_url="$value" ;;
    provenance_sha256) [ -z "$provenance_sha256" ] || die 'release manifest repeats provenance_sha256'; provenance_sha256="$value" ;;
    provenance_size) [ -z "$provenance_size" ] || die 'release manifest repeats provenance_size'; provenance_size="$value" ;;
    licenses_url) [ -z "$licenses_url" ] || die 'release manifest repeats licenses_url'; licenses_url="$value" ;;
    licenses_sha256) [ -z "$licenses_sha256" ] || die 'release manifest repeats licenses_sha256'; licenses_sha256="$value" ;;
    licenses_size) [ -z "$licenses_size" ] || die 'release manifest repeats licenses_size'; licenses_size="$value" ;;
    opencode_lock_url) [ -z "$opencode_lock_url" ] || die 'release manifest repeats opencode_lock_url'; opencode_lock_url="$value" ;;
    opencode_lock_sha256) [ -z "$opencode_lock_sha256" ] || die 'release manifest repeats opencode_lock_sha256'; opencode_lock_sha256="$value" ;;
    opencode_lock_size) [ -z "$opencode_lock_size" ] || die 'release manifest repeats opencode_lock_size'; opencode_lock_size="$value" ;;
    runtime_macos_x64_url) [ -z "$runtime_macos_x64_url" ] || die 'release manifest repeats runtime_macos_x64_url'; runtime_macos_x64_url="$value" ;;
    runtime_macos_x64_sha256) [ -z "$runtime_macos_x64_sha256" ] || die 'release manifest repeats runtime_macos_x64_sha256'; runtime_macos_x64_sha256="$value" ;;
    runtime_macos_x64_size) [ -z "$runtime_macos_x64_size" ] || die 'release manifest repeats runtime_macos_x64_size'; runtime_macos_x64_size="$value" ;;
    runtime_macos_arm64_url) [ -z "$runtime_macos_arm64_url" ] || die 'release manifest repeats runtime_macos_arm64_url'; runtime_macos_arm64_url="$value" ;;
    runtime_macos_arm64_sha256) [ -z "$runtime_macos_arm64_sha256" ] || die 'release manifest repeats runtime_macos_arm64_sha256'; runtime_macos_arm64_sha256="$value" ;;
    runtime_macos_arm64_size) [ -z "$runtime_macos_arm64_size" ] || die 'release manifest repeats runtime_macos_arm64_size'; runtime_macos_arm64_size="$value" ;;
    runtime_linux_x64_url) [ -z "$runtime_linux_x64_url" ] || die 'release manifest repeats runtime_linux_x64_url'; runtime_linux_x64_url="$value" ;;
    runtime_linux_x64_sha256) [ -z "$runtime_linux_x64_sha256" ] || die 'release manifest repeats runtime_linux_x64_sha256'; runtime_linux_x64_sha256="$value" ;;
    runtime_linux_x64_size) [ -z "$runtime_linux_x64_size" ] || die 'release manifest repeats runtime_linux_x64_size'; runtime_linux_x64_size="$value" ;;
    runtime_linux_arm64_url) [ -z "$runtime_linux_arm64_url" ] || die 'release manifest repeats runtime_linux_arm64_url'; runtime_linux_arm64_url="$value" ;;
    runtime_linux_arm64_sha256) [ -z "$runtime_linux_arm64_sha256" ] || die 'release manifest repeats runtime_linux_arm64_sha256'; runtime_linux_arm64_sha256="$value" ;;
    runtime_linux_arm64_size) [ -z "$runtime_linux_arm64_size" ] || die 'release manifest repeats runtime_linux_arm64_size'; runtime_linux_arm64_size="$value" ;;
    opencode_macos_x64_url) [ -z "$opencode_macos_x64_url" ] || die 'release manifest repeats opencode_macos_x64_url'; opencode_macos_x64_url="$value" ;;
    opencode_macos_x64_sha256) [ -z "$opencode_macos_x64_sha256" ] || die 'release manifest repeats opencode_macos_x64_sha256'; opencode_macos_x64_sha256="$value" ;;
    opencode_macos_x64_size) [ -z "$opencode_macos_x64_size" ] || die 'release manifest repeats opencode_macos_x64_size'; opencode_macos_x64_size="$value" ;;
    opencode_macos_arm64_url) [ -z "$opencode_macos_arm64_url" ] || die 'release manifest repeats opencode_macos_arm64_url'; opencode_macos_arm64_url="$value" ;;
    opencode_macos_arm64_sha256) [ -z "$opencode_macos_arm64_sha256" ] || die 'release manifest repeats opencode_macos_arm64_sha256'; opencode_macos_arm64_sha256="$value" ;;
    opencode_macos_arm64_size) [ -z "$opencode_macos_arm64_size" ] || die 'release manifest repeats opencode_macos_arm64_size'; opencode_macos_arm64_size="$value" ;;
    opencode_linux_x64_url) [ -z "$opencode_linux_x64_url" ] || die 'release manifest repeats opencode_linux_x64_url'; opencode_linux_x64_url="$value" ;;
    opencode_linux_x64_sha256) [ -z "$opencode_linux_x64_sha256" ] || die 'release manifest repeats opencode_linux_x64_sha256'; opencode_linux_x64_sha256="$value" ;;
    opencode_linux_x64_size) [ -z "$opencode_linux_x64_size" ] || die 'release manifest repeats opencode_linux_x64_size'; opencode_linux_x64_size="$value" ;;
    opencode_linux_arm64_url) [ -z "$opencode_linux_arm64_url" ] || die 'release manifest repeats opencode_linux_arm64_url'; opencode_linux_arm64_url="$value" ;;
    opencode_linux_arm64_sha256) [ -z "$opencode_linux_arm64_sha256" ] || die 'release manifest repeats opencode_linux_arm64_sha256'; opencode_linux_arm64_sha256="$value" ;;
    opencode_linux_arm64_size) [ -z "$opencode_linux_arm64_size" ] || die 'release manifest repeats opencode_linux_arm64_size'; opencode_linux_arm64_size="$value" ;;
    debian_inrelease_url) [ -z "$debian_inrelease_url" ] || die 'release manifest repeats debian_inrelease_url'; debian_inrelease_url="$value" ;;
    debian_inrelease_sha256) [ -z "$debian_inrelease_sha256" ] || die 'release manifest repeats debian_inrelease_sha256'; debian_inrelease_sha256="$value" ;;
    debian_inrelease_size) [ -z "$debian_inrelease_size" ] || die 'release manifest repeats debian_inrelease_size'; debian_inrelease_size="$value" ;;
    debian_keyring_url) [ -z "$debian_keyring_url" ] || die 'release manifest repeats debian_keyring_url'; debian_keyring_url="$value" ;;
    debian_keyring_sha256) [ -z "$debian_keyring_sha256" ] || die 'release manifest repeats debian_keyring_sha256'; debian_keyring_sha256="$value" ;;
    debian_keyring_size) [ -z "$debian_keyring_size" ] || die 'release manifest repeats debian_keyring_size'; debian_keyring_size="$value" ;;
    debian_packages_url) [ -z "$debian_packages_url" ] || die 'release manifest repeats debian_packages_url'; debian_packages_url="$value" ;;
    debian_packages_sha256) [ -z "$debian_packages_sha256" ] || die 'release manifest repeats debian_packages_sha256'; debian_packages_sha256="$value" ;;
    debian_packages_size) [ -z "$debian_packages_size" ] || die 'release manifest repeats debian_packages_size'; debian_packages_size="$value" ;;
    debian_tree_url) [ -z "$debian_tree_url" ] || die 'release manifest repeats debian_tree_url'; debian_tree_url="$value" ;;
    debian_tree_sha256) [ -z "$debian_tree_sha256" ] || die 'release manifest repeats debian_tree_sha256'; debian_tree_sha256="$value" ;;
    debian_tree_size) [ -z "$debian_tree_size" ] || die 'release manifest repeats debian_tree_size'; debian_tree_size="$value" ;;
    *) die "release manifest contains unknown field: $key" ;;
  esac
done < "$MANIFEST"

[ -n "$schema_version" ] && [ -n "$release_id" ] && [ -n "$source_commit" ] && [ -n "$created_at" ] \\
  && [ -n "$expires_at" ] && [ -n "$key_id" ] && [ -n "$artifact_url" ] \\
  && [ -n "$artifact_sha256" ] && [ -n "$artifact_size" ] \\
  && [ -n "$engine_url" ] && [ -n "$engine_sha256" ] && [ -n "$engine_size" ] \\
  && [ -n "$catalog_url" ] && [ -n "$catalog_sha256" ] && [ -n "$catalog_size" ] \\
  && [ -n "$launcher_url" ] && [ -n "$launcher_sha256" ] && [ -n "$launcher_size" ] \\
  && [ -n "$engine_node_min" ] && [ -n "$runtime_node_version" ] \
  && [ -n "$runtime_macos_x64_url" ] && [ -n "$runtime_macos_x64_sha256" ] && [ -n "$runtime_macos_x64_size" ] \
  && [ -n "$runtime_macos_arm64_url" ] && [ -n "$runtime_macos_arm64_sha256" ] && [ -n "$runtime_macos_arm64_size" ] \
  && [ -n "$runtime_linux_x64_url" ] && [ -n "$runtime_linux_x64_sha256" ] && [ -n "$runtime_linux_x64_size" ] \
  && [ -n "$runtime_linux_arm64_url" ] && [ -n "$runtime_linux_arm64_sha256" ] && [ -n "$runtime_linux_arm64_size" ] || die 'release manifest is incomplete'
[ "$schema_version" = "$EXPECTED_MANIFEST_SCHEMA" ] || die 'unsupported release manifest schema'
if [ -n "$EXPECTED_PRODUCT_ID" ]; then
  [ "$product_id" = "$EXPECTED_PRODUCT_ID" ] || die 'release manifest product does not match the bootstrap product'
  [ -n "$opencode_version" ] && [ -n "$supervisor_url" ] && [ -n "$supervisor_sha256" ] && [ -n "$supervisor_size" ] \
    && [ -n "$tools_url" ] && [ -n "$tools_sha256" ] && [ -n "$tools_size" ] \
    && [ -n "$sbom_url" ] && [ -n "$sbom_sha256" ] && [ -n "$sbom_size" ] \
    && [ -n "$provenance_url" ] && [ -n "$provenance_sha256" ] && [ -n "$provenance_size" ] \
    && [ -n "$licenses_url" ] && [ -n "$licenses_sha256" ] && [ -n "$licenses_size" ] \
    && [ -n "$opencode_lock_url" ] && [ -n "$opencode_lock_sha256" ] && [ -n "$opencode_lock_size" ] \
    && [ -n "$opencode_macos_x64_url" ] && [ -n "$opencode_macos_x64_sha256" ] && [ -n "$opencode_macos_x64_size" ] \
    && [ -n "$opencode_macos_arm64_url" ] && [ -n "$opencode_macos_arm64_sha256" ] && [ -n "$opencode_macos_arm64_size" ] \
    && [ -n "$opencode_linux_x64_url" ] && [ -n "$opencode_linux_x64_sha256" ] && [ -n "$opencode_linux_x64_size" ] \
    && [ -n "$opencode_linux_arm64_url" ] && [ -n "$opencode_linux_arm64_sha256" ] && [ -n "$opencode_linux_arm64_size" ] \
    && [ -n "$debian_inrelease_url" ] && [ -n "$debian_inrelease_sha256" ] && [ -n "$debian_inrelease_size" ] \
    && [ -n "$debian_keyring_url" ] && [ -n "$debian_keyring_sha256" ] && [ -n "$debian_keyring_size" ] \
    && [ -n "$debian_packages_url" ] && [ -n "$debian_packages_sha256" ] && [ -n "$debian_packages_size" ] \
    && [ -n "$debian_tree_url" ] && [ -n "$debian_tree_sha256" ] && [ -n "$debian_tree_size" ] \
    || die 'Desktop Tools runtime closure is incomplete'
else
  [ -z "$product_id" ] || die 'legacy release manifest must not claim a Desktop Tools product identity'
fi
[ "$key_id" = "$SIGNER_ID" ] || die 'release manifest uses an unknown signing identity'
[ "$release_id" = "$EXPECTED_RELEASE_ID" ] || die 'release manifest identity does not match the configured immutable release'
case "$release_id" in *[!a-zA-Z0-9._-]*|'') die 'invalid release identifier' ;; esac
case "$source_commit" in *[!0-9a-f]*|'') die 'invalid source commit' ;; esac
[ "\${#source_commit}" -eq 40 ] || die 'source commit must be a full immutable SHA-1'
case "$created_at:$expires_at:$artifact_size:$engine_size:$catalog_size:$launcher_size:$engine_node_min:$runtime_macos_x64_size:$runtime_macos_arm64_size:$runtime_linux_x64_size:$runtime_linux_arm64_size" in *[!0-9:]*|'') die 'manifest timestamps and sizes must be integers' ;; esac
[[ "$runtime_node_version" =~ ^24\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]] || die 'unsupported runtime Node version'
if [ -n "$EXPECTED_PRODUCT_ID" ]; then
  [[ "$opencode_version" =~ ^2\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]] || die 'unsupported pinned OpenCode version'
fi
case "$artifact_sha256" in *[!0-9a-f]*|'') die 'invalid artifact digest' ;; esac
[ "\${#artifact_sha256}" -eq 64 ] || die 'artifact digest must be SHA-256'
case "$engine_sha256" in *[!0-9a-f]*|'') die 'invalid engine digest' ;; esac
[ "\${#engine_sha256}" -eq 64 ] || die 'engine digest must be SHA-256'
case "$catalog_sha256" in *[!0-9a-f]*|'') die 'invalid catalog digest' ;; esac
[ "\${#catalog_sha256}" -eq 64 ] || die 'catalog digest must be SHA-256'
case "$launcher_sha256" in *[!0-9a-f]*|'') die 'invalid launcher digest' ;; esac
[ "\${#launcher_sha256}" -eq 64 ] || die 'launcher digest must be SHA-256'
[ "$artifact_url" = "$RELEASE_ORIGIN/releases/$release_id/provision.sh" ] \
  || die 'release artifact URL does not match the signed immutable release'
[ "$engine_url" = "$RELEASE_ORIGIN/releases/$release_id/${policy.engineFilename}" ] \\
  || die 'release engine URL does not match the signed immutable release'
[ "$catalog_url" = "$RELEASE_ORIGIN/releases/$release_id/catalog.json" ] \\
  || die 'release catalog URL does not match the signed immutable release'
[ "$launcher_url" = "$RELEASE_ORIGIN/releases/$release_id/start" ] \\
  || die 'release launcher URL does not match the signed immutable release'
[ "$artifact_size" -gt 0 ] && [ "$artifact_size" -le "$MAX_ARTIFACT_BYTES" ] || die 'artifact size is outside policy'
[ "$engine_size" -gt 0 ] && [ "$engine_size" -le "$MAX_ARTIFACT_BYTES" ] || die 'engine size is outside policy'
[ "$catalog_size" -gt 0 ] && [ "$catalog_size" -le "$MAX_CATALOG_BYTES" ] || die 'catalog size is outside policy'
[ "$launcher_size" -gt 0 ] && [ "$launcher_size" -le "$MAX_ARTIFACT_BYTES" ] || die 'launcher size is outside policy'
[ "$engine_node_min" -eq "$MIN_ENGINE_NODE_MAJOR" ] || die 'unsupported engine Node runtime requirement'
for runtime_platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do
  runtime_key="$(printf '%s' "$runtime_platform" | tr '-' '_')"
  runtime_url_name="runtime_\${runtime_key}_url"
  runtime_sha256_name="runtime_\${runtime_key}_sha256"
  runtime_size_name="runtime_\${runtime_key}_size"
  runtime_url="\${!runtime_url_name}"
  runtime_sha256="\${!runtime_sha256_name}"
  runtime_size="\${!runtime_size_name}"
  [ "$runtime_url" = "$RELEASE_ORIGIN/releases/$release_id/node-$runtime_platform.tar.gz" ] || die 'runtime URL does not match the signed immutable release and platform'
  case "$runtime_sha256" in *[!0-9a-f]*|'') die 'invalid runtime digest' ;; esac
  [ "\${#runtime_sha256}" -eq 64 ] || die 'runtime digest must be SHA-256'
  [ "$runtime_size" -gt 0 ] && [ "$runtime_size" -le "$MAX_RUNTIME_BYTES" ] || die 'runtime size is outside policy'
done
if [ -n "$EXPECTED_PRODUCT_ID" ]; then
  for closure_spec in \
    'supervisor:desktop-tools-supervisor.mjs:8388608' \
    'tools:desktop-tools-tools.tar.gz:33554432' \
    'sbom:release.sbom.json:8388608' \
    'provenance:release.provenance.json:8388608' \
    'licenses:THIRD_PARTY_LICENSES.txt:8388608' \
    'opencode_lock:opencode.lock.json:8388608' \
    'debian_inrelease:debian-bookworm-inrelease:16777216' \
    'debian_keyring:debian-bookworm-archive-keyring.gpg:16777216' \
    'debian_packages:debian-bookworm-main-amd64-Packages.xz:268435456' \
    'debian_tree:tree_2.1.0-1_amd64.deb:268435456'; do
    IFS=: read -r closure_prefix closure_filename closure_maximum <<< "$closure_spec"
    closure_url_name="\${closure_prefix}_url"; closure_sha_name="\${closure_prefix}_sha256"; closure_size_name="\${closure_prefix}_size"
    closure_url="\${!closure_url_name}"; closure_sha="\${!closure_sha_name}"; closure_size="\${!closure_size_name}"
    [ "$closure_url" = "$RELEASE_ORIGIN/releases/$release_id/$closure_filename" ] || die 'Desktop Tools closure URL does not match the signed immutable release'
    case "$closure_sha" in *[!0-9a-f]*|'') die 'invalid Desktop Tools closure digest' ;; esac
    [ "\${#closure_sha}" -eq 64 ] || die 'Desktop Tools closure digest must be SHA-256'
    case "$closure_size" in *[!0-9]*|'') die 'Desktop Tools closure size must be an integer' ;; esac
    [ "$closure_size" -gt 0 ] && [ "$closure_size" -le "$closure_maximum" ] || die 'Desktop Tools closure size is outside policy'
  done
  for opencode_platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do
    opencode_key="$(printf '%s' "$opencode_platform" | tr '-' '_')"
    opencode_url_name="opencode_\${opencode_key}_url"; opencode_sha_name="opencode_\${opencode_key}_sha256"; opencode_size_name="opencode_\${opencode_key}_size"
    opencode_url="\${!opencode_url_name}"; opencode_sha="\${!opencode_sha_name}"; opencode_size="\${!opencode_size_name}"
    case "$opencode_platform" in macos-*) opencode_filename="opencode-$opencode_platform.zip" ;; *) opencode_filename="opencode-$opencode_platform.tar.gz" ;; esac
    [ "$opencode_url" = "$RELEASE_ORIGIN/releases/$release_id/$opencode_filename" ] || die 'OpenCode URL does not match the signed immutable release and platform'
    case "$opencode_sha" in *[!0-9a-f]*|'') die 'invalid OpenCode digest' ;; esac
    [ "\${#opencode_sha}" -eq 64 ] || die 'OpenCode digest must be SHA-256'
    case "$opencode_size" in *[!0-9]*|'') die 'OpenCode size must be an integer' ;; esac
    [ "$opencode_size" -gt 0 ] && [ "$opencode_size" -le "$MAX_OPENCODE_BYTES" ] || die 'OpenCode size is outside policy'
  done
fi
now="$(date -u +%s 2>/dev/null)" || die 'a reliable UTC clock is required to validate release expiry'
case "$now" in *[!0-9]*|'') die 'a reliable UTC clock is required to validate release expiry' ;; esac
[ "$created_at" -le "$now" ] || die 'release manifest is not valid yet; correct the system clock'
[ "$now" -lt "$expires_at" ] || die 'release manifest expired; refresh the launcher after correcting the system clock'
[ "$((expires_at - created_at))" -le "$MAX_RELEASE_LIFETIME" ] || die 'release manifest lifetime exceeds the seven-day replay policy'

runtime_key="$(printf '%s' "$BOOTSTRAP_PLATFORM" | tr '-' '_')"
runtime_url_name="runtime_\${runtime_key}_url"
runtime_sha256_name="runtime_\${runtime_key}_sha256"
runtime_size_name="runtime_\${runtime_key}_size"
runtime_url="\${!runtime_url_name}"
runtime_sha256="\${!runtime_sha256_name}"
runtime_size="\${!runtime_size_name}"
runtime_source='signed-archive'
runtime_archive="$RUNTIME_ARCHIVE"
runtime_node=''
runtime_effective_version="$runtime_node_version"
runtime_effective_url="$runtime_url"
runtime_effective_sha256="$runtime_sha256"
runtime_effective_size="$runtime_size"
opencode_url=''; opencode_sha256=''; opencode_size=''
if [ -n "$EXPECTED_PRODUCT_ID" ]; then
  opencode_url_name="opencode_\${runtime_key}_url"; opencode_sha_name="opencode_\${runtime_key}_sha256"; opencode_size_name="opencode_\${runtime_key}_size"
  opencode_url="\${!opencode_url_name}"; opencode_sha256="\${!opencode_sha_name}"; opencode_size="\${!opencode_size_name}"
fi
system_node="$(PATH="$APPROVED_PATH" command -v node 2>/dev/null || true)"
if [ -n "$system_node" ]; then
  system_version="$(PATH="$APPROVED_PATH" "$system_node" --version 2>/dev/null || true)"
  system_major="$(printf '%s' "$system_version" | sed -nE 's/^v([0-9]+)\\..*/\\1/p')"
  case "$system_major" in
    22|24)
      if [ "$system_major" -ge "$engine_node_min" ]; then
        runtime_source='system'
        runtime_archive=''
        runtime_node="$system_node"
        runtime_effective_version="\${system_version#v}"
        runtime_effective_url=''
        runtime_effective_sha256=''
        runtime_effective_size=''
      fi
      ;;
  esac
fi
if [ "$runtime_source" = 'signed-archive' ]; then
  :
fi
printf '${policy.diagnosticName}: fetching verified release payloads in parallel...\n' >&2
download "$artifact_url" "$ARTIFACT" "$artifact_size" & DOWNLOAD_PIDS+=("$!")
download "$engine_url" "$ENGINE" "$engine_size" & DOWNLOAD_PIDS+=("$!")
download "$catalog_url" "$CATALOG" "$catalog_size" & DOWNLOAD_PIDS+=("$!")
if [ -n "$EXPECTED_PRODUCT_ID" ]; then
  download "$opencode_url" "$OPENCODE_ARCHIVE" "$opencode_size" & DOWNLOAD_PIDS+=("$!")
  download "$supervisor_url" "$SUPERVISOR" "$supervisor_size" & DOWNLOAD_PIDS+=("$!")
  download "$tools_url" "$TOOLS" "$tools_size" & DOWNLOAD_PIDS+=("$!")
  download "$sbom_url" "$SBOM" "$sbom_size" & DOWNLOAD_PIDS+=("$!")
  download "$provenance_url" "$PROVENANCE" "$provenance_size" & DOWNLOAD_PIDS+=("$!")
  download "$licenses_url" "$LICENSES" "$licenses_size" & DOWNLOAD_PIDS+=("$!")
  download "$opencode_lock_url" "$OPENCODE_LOCK" "$opencode_lock_size" & DOWNLOAD_PIDS+=("$!")
fi
if [ "$runtime_source" = 'signed-archive' ]; then
  download "$runtime_url" "$RUNTIME_ARCHIVE" "$runtime_size" & DOWNLOAD_PIDS+=("$!")
fi
download_failed=0
for pid in "\${DOWNLOAD_PIDS[@]}"; do [ -z "$pid" ] || if ! wait "$pid"; then download_failed=1; fi; done
DOWNLOAD_PIDS=('')
[ "$download_failed" -eq 0 ] || die 'release payload download failed'
[ "$(size "$ARTIFACT")" -eq "$artifact_size" ] || die 'provisioner size does not match the signed manifest'
[ "$(sha256 "$ARTIFACT")" = "$artifact_sha256" ] || die 'provisioner checksum does not match the signed manifest'
[ "$(size "$ENGINE")" -eq "$engine_size" ] || die 'engine size does not match the signed manifest'
[ "$(sha256 "$ENGINE")" = "$engine_sha256" ] || die 'engine checksum does not match the signed manifest'
[ "$(size "$CATALOG")" -eq "$catalog_size" ] || die 'catalog size does not match the signed manifest'
[ "$(sha256 "$CATALOG")" = "$catalog_sha256" ] || die 'catalog checksum does not match the signed manifest'
if [ "$runtime_source" = 'signed-archive' ]; then
  [ "$(size "$RUNTIME_ARCHIVE")" -eq "$runtime_size" ] || die 'runtime size does not match the signed manifest'
  [ "$(sha256 "$RUNTIME_ARCHIVE")" = "$runtime_sha256" ] || die 'runtime checksum does not match the signed manifest'
fi
if [ -n "$EXPECTED_PRODUCT_ID" ]; then
  for verified_spec in \
    "$OPENCODE_ARCHIVE:$opencode_size:$opencode_sha256:OpenCode" \
    "$SUPERVISOR:$supervisor_size:$supervisor_sha256:supervisor" \
    "$TOOLS:$tools_size:$tools_sha256:tools" \
    "$SBOM:$sbom_size:$sbom_sha256:SBOM" \
    "$PROVENANCE:$provenance_size:$provenance_sha256:provenance" \
    "$LICENSES:$licenses_size:$licenses_sha256:licenses" \
    "$OPENCODE_LOCK:$opencode_lock_size:$opencode_lock_sha256:OpenCode-lock"; do
    IFS=: read -r verified_path verified_size verified_sha verified_label <<< "$verified_spec"
    [ "$(size "$verified_path")" -eq "$verified_size" ] || die "$verified_label size does not match the signed manifest"
    [ "$(sha256 "$verified_path")" = "$verified_sha" ] || die "$verified_label checksum does not match the signed manifest"
  done
fi
chmod 0700 "$ARTIFACT" "$ENGINE"
chmod 0600 "$CATALOG"
[ "$runtime_source" = 'system' ] || chmod 0600 "$RUNTIME_ARCHIVE"
if [ -n "$EXPECTED_PRODUCT_ID" ]; then chmod 0700 "$SUPERVISOR"; chmod 0600 "$OPENCODE_ARCHIVE" "$TOOLS" "$SBOM" "$PROVENANCE" "$LICENSES" "$OPENCODE_LOCK"; fi
manifest_sha256="$(sha256 "$MANIFEST")"

# Do not forward arbitrary caller state, proxy configuration, shell startup hooks,
# credentials, or debugging controls into the verified provisioner.
set +e
env -i \\
  HOME="\${HOME:-}" USER="\${USER:-}" LOGNAME="\${LOGNAME:-}" PATH="$APPROVED_PATH" \\
  LANG="\${LANG:-C}" LC_ALL="\${LC_ALL:-}" TERM="\${TERM:-dumb}" COLORTERM="\${COLORTERM:-}" \\
  HEADLESS_INSTALL="\${HEADLESS_INSTALL:-}" SOFTWARE_GROUP="\${SOFTWARE_GROUP:-}" \\
  INSTALL_DOCTOR_ROLE="\${INSTALL_DOCTOR_ROLE:-}" INSTALL_DOCTOR_CAPABILITY="\${INSTALL_DOCTOR_CAPABILITY:-}" \\
  INSTALL_DOCTOR_NETWORK="\${INSTALL_DOCTOR_NETWORK:-}" INSTALL_DOCTOR_CONCURRENCY="\${INSTALL_DOCTOR_CONCURRENCY:-}" \\
  INSTALL_DOCTOR_SELECTED_SERVICES="\${INSTALL_DOCTOR_SELECTED_SERVICES:-}" \\
  INSTALL_DOCTOR_SELECTED_PACKAGES="\${INSTALL_DOCTOR_SELECTED_PACKAGES:-}" \\
  INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS="\${INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS:-}" \\
  INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS="\${INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS:-}" \\
  INSTALL_DOCTOR_CONSENT_PRIVILEGED="\${INSTALL_DOCTOR_CONSENT_PRIVILEGED:-false}" \\
  INSTALL_DOCTOR_CONSENT_NETWORK="\${INSTALL_DOCTOR_CONSENT_NETWORK:-false}" \\
  INSTALL_DOCTOR_CONSENT_BEST_EFFORT="\${INSTALL_DOCTOR_CONSENT_BEST_EFFORT:-false}" INSTALL_DOCTOR_OFFLINE="\${INSTALL_DOCTOR_OFFLINE:-false}" \\
  INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="\${INSTALL_DOCTOR_APPROVED_PLAN_DIGEST:-}" \\
  INSTALL_DOCTOR_RELEASE_ID="$release_id" INSTALL_DOCTOR_SOURCE_COMMIT="$source_commit" \\
  DESKTOP_TOOLS_RELEASE_ID="$release_id" DESKTOP_TOOLS_SOURCE_COMMIT="$source_commit" \\
  DESKTOP_TOOLS_PROFILE_ID="$DESKTOP_TOOLS_PROFILE_ID" DESKTOP_TOOLS_PROFILE_SLUG="$DESKTOP_TOOLS_PROFILE_SLUG" \\
  DESKTOP_TOOLS_PROFILE_REVISION="$DESKTOP_TOOLS_PROFILE_REVISION" DESKTOP_TOOLS_PROFILE_DIGEST="$DESKTOP_TOOLS_PROFILE_DIGEST" \\
  DESKTOP_TOOLS_OPENCODE_VERSION="$opencode_version" DESKTOP_TOOLS_OPENCODE_ARCHIVE="$OPENCODE_ARCHIVE" DESKTOP_TOOLS_OPENCODE_SHA256="$opencode_sha256" \\
  DESKTOP_TOOLS_SUPERVISOR_PATH="$SUPERVISOR" DESKTOP_TOOLS_SUPERVISOR_SHA256="$supervisor_sha256" \\
  DESKTOP_TOOLS_TOOLS_ARCHIVE="$TOOLS" DESKTOP_TOOLS_TOOLS_SHA256="$tools_sha256" \\
  DESKTOP_TOOLS_SBOM_PATH="$SBOM" DESKTOP_TOOLS_PROVENANCE_PATH="$PROVENANCE" DESKTOP_TOOLS_LICENSES_PATH="$LICENSES" \\
  DESKTOP_TOOLS_OPENCODE_LOCK_PATH="$OPENCODE_LOCK" DESKTOP_TOOLS_OPENCODE_LOCK_SHA256="$opencode_lock_sha256" \\
  DESKTOP_TOOLS_DEBIAN_INRELEASE_URL="$debian_inrelease_url" DESKTOP_TOOLS_DEBIAN_INRELEASE_SHA256="$debian_inrelease_sha256" DESKTOP_TOOLS_DEBIAN_INRELEASE_SIZE="$debian_inrelease_size" \\
  DESKTOP_TOOLS_DEBIAN_KEYRING_URL="$debian_keyring_url" DESKTOP_TOOLS_DEBIAN_KEYRING_SHA256="$debian_keyring_sha256" DESKTOP_TOOLS_DEBIAN_KEYRING_SIZE="$debian_keyring_size" \\
  DESKTOP_TOOLS_DEBIAN_PACKAGES_URL="$debian_packages_url" DESKTOP_TOOLS_DEBIAN_PACKAGES_SHA256="$debian_packages_sha256" DESKTOP_TOOLS_DEBIAN_PACKAGES_SIZE="$debian_packages_size" \\
  DESKTOP_TOOLS_DEBIAN_TREE_URL="$debian_tree_url" DESKTOP_TOOLS_DEBIAN_TREE_SHA256="$debian_tree_sha256" DESKTOP_TOOLS_DEBIAN_TREE_SIZE="$debian_tree_size" \\
  INSTALL_DOCTOR_BOOTSTRAP_PLATFORM="$BOOTSTRAP_PLATFORM" \\
  INSTALL_DOCTOR_VERIFIED_MANIFEST="$MANIFEST" INSTALL_DOCTOR_VERIFIED_SIGNATURE="$SIGNATURE" \\
  INSTALL_DOCTOR_MANIFEST_SHA256="$manifest_sha256" INSTALL_DOCTOR_ARTIFACT_SHA256="$artifact_sha256" \\
  INSTALL_DOCTOR_ENGINE_PATH="$ENGINE" INSTALL_DOCTOR_ENGINE_SHA256="$engine_sha256" \\
  INSTALL_DOCTOR_CATALOG_PATH="$CATALOG" INSTALL_DOCTOR_CATALOG_SHA256="$catalog_sha256" \\
  INSTALL_DOCTOR_ENGINE_NODE_MIN="$engine_node_min" \\
  INSTALL_DOCTOR_RUNTIME_SOURCE="$runtime_source" INSTALL_DOCTOR_RUNTIME_NODE="$runtime_node" \\
  INSTALL_DOCTOR_RUNTIME_URL="$runtime_effective_url" INSTALL_DOCTOR_RUNTIME_SHA256="$runtime_effective_sha256" \\
  INSTALL_DOCTOR_RUNTIME_SIZE="$runtime_effective_size" INSTALL_DOCTOR_RUNTIME_PLATFORM="$BOOTSTRAP_PLATFORM" \\
  INSTALL_DOCTOR_RUNTIME_NODE_VERSION="$runtime_effective_version" INSTALL_DOCTOR_RUNTIME_ARCHIVE="$runtime_archive" \\
  bash "$ARTIFACT" "$@" < "$(if [ "\${HEADLESS_INSTALL:-0}" = 1 ] || [ ! -r /dev/tty ]; then printf /dev/null; else printf /dev/tty; fi)"
status=$?
set -e
exit "$status"
`;
}
