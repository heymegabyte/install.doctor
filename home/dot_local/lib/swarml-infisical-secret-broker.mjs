import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";

function enableVerifiedSystemCaTrust() {
  setDefaultCACertificates([
    ...new Set([...getCACertificates("default"), ...getCACertificates("system")]),
  ]);
}

function readOwnerOnlyToken(tokenPath, expectedUid) {
  const info = lstatSync(tokenPath);
  const uid = expectedUid ?? (typeof process.getuid === "function" ? process.getuid() : info.uid);
  if (!info.isFile() || info.uid !== uid || (info.mode & 0o077) !== 0) {
    throw new Error("Workload credential is not owner-only");
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  if (token.length < 20 || token.length > 4096 || /[\r\n]/.test(token)) {
    throw new Error("Workload credential is malformed");
  }
  return token;
}

async function requestJson(url, token, binding, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": binding.userAgent,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(binding.requestTimeoutMs),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Redirect refused");
  }
  if (!response.ok) {
    throw new Error("Workload secret lookup failed");
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Workload secret response is malformed");
  }
  return payload;
}

export async function resolvePinnedInfisicalSecret(binding, options = {}) {
  enableVerifiedSystemCaTrust();
  const home = options.homeDir ?? homedir();
  const tokenPath = join(home, binding.tokenRelativePath);
  const token = readOwnerOnlyToken(tokenPath, options.uid);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const query = new URLSearchParams({
    workspaceId: binding.projectId,
    environment: binding.environment,
    secretPath: binding.secretPath,
    type: "shared",
  });

  const inventoryQuery = new URLSearchParams(query);
  inventoryQuery.set("recursive", "true");
  inventoryQuery.set("include_imports", "true");
  const inventory = await requestJson(
    `${binding.origin}/api/v3/secrets/raw?${inventoryQuery}`,
    token,
    binding,
    fetchImpl,
  );
  const names = Array.isArray(inventory.secrets)
    ? inventory.secrets.map((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry) ? entry.secretKey : null,
      )
    : [];
  if (names.length !== 1 || names[0] !== binding.secretName) {
    throw new Error("Workload secret scope no longer matches its exact binding");
  }

  const payload = await requestJson(
    `${binding.origin}/api/v3/secrets/raw/${binding.secretName}?${query}`,
    token,
    binding,
    fetchImpl,
  );
  const secret = payload.secret;
  if (
    !secret ||
    typeof secret !== "object" ||
    Array.isArray(secret) ||
    secret.secretKey !== binding.secretName ||
    typeof secret.secretValue !== "string" ||
    secret.secretValue.length === 0
  ) {
    throw new Error("Workload secret response is malformed");
  }
  return secret.secretValue;
}
