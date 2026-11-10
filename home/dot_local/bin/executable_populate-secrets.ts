#!/usr/bin/env -S node --experimental-strip-types
/**
 * Scan plausible local secret sources and write age-encrypted chezmoi-secret
 * templates (~/.local/share/chezmoi/home/.chezmoitemplates/secrets/<NAME>)
 * idempotently without clobbering existing encrypted files.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

type EncryptionOutcome = "wrote" | "exists" | "empty" | "err";

interface ScanCounters {
  wrote: number;
  exists: number;
  empty: number;
  err: number;
}

const SECRETS_DIR = join(homedir(), ".local/share/chezmoi/home/.chezmoitemplates/secrets");
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const ENV_SECRET_CANDIDATES: readonly string[] = [
  "EMDASH_HOOK_TOKEN", "JFS_PRIVATE_KEY", "WAKATIME_API_KEY",
  "NPM_TOKEN", "NODE_AUTH_TOKEN", "GITLAB_TOKEN", "BITBUCKET_TOKEN",
  "FLY_API_TOKEN", "VERCEL_TOKEN", "NETLIFY_AUTH_TOKEN",
  "DIGITALOCEAN_TOKEN", "LINODE_TOKEN", "HETZNER_TOKEN",
  "PUSHOVER_TOKEN", "NTFY_TOKEN",
  "NGROK_AUTHTOKEN", "CLOUDFLARE_ZONE_ID",
  "TURSO_AUTH_TOKEN", "NEON_API_KEY", "PLANETSCALE_TOKEN",
  "RAILWAY_TOKEN", "RENDER_API_KEY", "SUPABASE_ACCESS_TOKEN",
  "CONVEX_DEPLOY_KEY", "CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY",
  "AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET",
  "OPENROUTER_API_KEY", "PERPLEXITY_API_KEY", "TOGETHER_API_KEY",
  "GROQ_API_KEY", "MISTRAL_API_KEY", "COHERE_API_KEY",
  "REPLICATE_API_TOKEN", "HUGGINGFACE_TOKEN", "HF_TOKEN",
  "POSTHOG_PROJECT_API_KEY", "AMPLITUDE_API_KEY", "MIXPANEL_TOKEN",
  "SLACK_BOT_TOKEN", "SLACK_WEBHOOK_URL", "TELEGRAM_BOT_TOKEN",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
  "NOTION_API_KEY", "LINEAR_API_KEY", "AIRTABLE_API_KEY",
  "FIRECRAWL_API_KEY", "BROWSERLESS_TOKEN", "SCRAPER_API_KEY",
  "COMPOSIO_API_KEY", "BRAVE_API_KEY",
  "INFISICAL_TOKEN", "DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2", "DEEPSEEK_API_KEY_3",
  "DEEPSEEK_API_KEY_4", "DEEPSEEK_API_KEY_5", "DEEPSEEK_API_KEY_6",
  "ANTHROPIC_API_KEY", "OLLAMA_GATEWAY_TOKEN", "OLLAMA_API_KEY", "LITELLM_API_KEY",
  "LITELLM_KEY_WORKER", "LITELLM_KEY_TWENTY", "AID_API_KEY",
  "DESKTOP_AUTOLOGIN_PASSWORD", "HISHTORY_USER_SECRET", "CLOUDFLARE_API_TOKEN",
];

const KEYCHAIN_CANDIDATES: ReadonlyArray<readonly [string, string, string | null]> = [
  ["Claude Code-credentials", "CLAUDE_CODE_CREDENTIALS_JSON", null],
  ["dev.warp.Warp-Stable", "WARP_KEYCHAIN_TOKEN", null],
];

function logMessage(level: "info" | "ok" | "skip" | "warn" | "err", msg: string): void {
  const icons: Record<string, string> = { info: "▶", ok: "✔", skip: "·", warn: "◆", err: "✗" };
  const colors: Record<string, string> = { ok: GREEN, err: RED, skip: DIM };
  process.stderr.write(`  ${colors[level] ?? ""}${icons[level] ?? " "} ${msg}${RESET}\n`);
}

function encryptSecret(name: string, value: string, existing: Set<string>): EncryptionOutcome {
  if (!value || !value.trim()) {
    return "empty";
  }
  if (existing.has(name)) {
    return "exists";
  }
  const proc = spawnSync("chezmoi", ["encrypt"], {
    input: Buffer.from(value, "utf8"),
    timeout: 10_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (proc.status !== 0 || !proc.stdout) {
    const errText = proc.stderr ? proc.stderr.toString("utf8").slice(0, 120) : "encrypt failed";
    logMessage("err", `${name}: ${errText}`);
    return "err";
  }
  writeFileSync(join(SECRETS_DIR, name), proc.stdout);
  existing.add(name);
  return "wrote";
}

function emptyCounters(): ScanCounters {
  return { wrote: 0, exists: 0, empty: 0, err: 0 };
}

function scanEnvironment(existing: Set<string>): ScanCounters {
  const counts = emptyCounters();
  for (const name of ENV_SECRET_CANDIDATES) {
    const outcome = encryptSecret(name, process.env[name] ?? "", existing);
    counts[outcome] += 1;
    if (outcome === "wrote") {
      logMessage("ok", name);
    }
  }
  return counts;
}

function scanGitHubCli(existing: Set<string>): ScanCounters {
  const counts = emptyCounters();
  const proc = spawnSync("gh", ["auth", "token"], { encoding: "utf8", timeout: 5_000 });
  if (proc.status === 0 && typeof proc.stdout === "string") {
    const outcome = encryptSecret("GH_AUTH_TOKEN", proc.stdout.trim(), existing);
    counts[outcome] += 1;
    if (outcome === "wrote") {
      logMessage("ok", "GH_AUTH_TOKEN (from gh CLI)");
    }
  }
  return counts;
}

function scanHishtory(existing: Set<string>): ScanCounters {
  const counts = emptyCounters();
  const proc = spawnSync("hishtory", ["status"], { encoding: "utf8", timeout: 5_000 });
  if (proc.status === 0 && typeof proc.stdout === "string") {
    for (const line of proc.stdout.split(/\r?\n/)) {
      const idx = line.indexOf("Secret Key:");
      if (idx !== -1) {
        const secret = line.slice(idx + "Secret Key:".length).trim();
        const outcome = encryptSecret("HISHTORY_USER_SECRET", secret, existing);
        counts[outcome] += 1;
        if (outcome === "wrote") {
          logMessage("ok", "HISHTORY_USER_SECRET (from hishtory)");
        }
        break;
      }
    }
  }
  return counts;
}

function scanDarwinKeychain(existing: Set<string>): ScanCounters {
  const counts = emptyCounters();
  if (platform() !== "darwin") {
    return counts;
  }
  for (const [service, targetName, account] of KEYCHAIN_CANDIDATES) {
    const args = account
      ? ["find-generic-password", "-s", service, "-a", account, "-w"]
      : ["find-generic-password", "-s", service, "-w"];
    const proc = spawnSync("security", args, { encoding: "utf8", timeout: 5_000 });
    if (proc.status === 0 && typeof proc.stdout === "string") {
      const outcome = encryptSecret(targetName, proc.stdout.trim(), existing);
      counts[outcome] += 1;
      if (outcome === "wrote") {
        logMessage("ok", `${targetName} (from Keychain '${service}')`);
      }
    }
  }
  return counts;
}

function scanAwsCredentials(existing: Set<string>): ScanCounters {
  const counts = emptyCounters();
  const credsPath = join(homedir(), ".aws", "credentials");
  if (!existsSync(credsPath)) {
    return counts;
  }
  let currentSection = "";
  const sections: Record<string, Record<string, string>> = {};
  for (const rawLine of readFileSync(credsPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.slice(1, -1).trim();
      sections[currentSection] ??= {};
    } else if (line.includes("=") && currentSection) {
      const eq = line.indexOf("=");
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      sections[currentSection]![k] = v;
    }
  }
  const def = sections.default ?? {};
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ["aws_access_key_id", "AWS_ACCESS_KEY_ID_FROM_FILE"],
    ["aws_secret_access_key", "AWS_SECRET_ACCESS_KEY_FROM_FILE"],
  ];
  for (const [awsKey, targetName] of pairs) {
    if (def[awsKey]) {
      const outcome = encryptSecret(targetName, def[awsKey]!, existing);
      counts[outcome] += 1;
      if (outcome === "wrote") {
        logMessage("ok", `${targetName} (from ~/.aws/credentials)`);
      }
    }
  }
  return counts;
}

function scanNpmrc(existing: Set<string>): ScanCounters {
  const counts = emptyCounters();
  const npmrcPath = join(homedir(), ".npmrc");
  if (!existsSync(npmrcPath)) {
    return counts;
  }
  for (const line of readFileSync(npmrcPath, "utf8").split(/\r?\n/)) {
    const idx = line.indexOf("_authToken=");
    if (idx !== -1) {
      const token = line.slice(idx + "_authToken=".length).trim();
      const outcome = encryptSecret("NPM_AUTH_TOKEN", token, existing);
      counts[outcome] += 1;
      if (outcome === "wrote") {
        logMessage("ok", "NPM_AUTH_TOKEN (from ~/.npmrc)");
      }
      break;
    }
  }
  return counts;
}

function main(): number {
  if (!existsSync(SECRETS_DIR) || !statSync(SECRETS_DIR).isDirectory()) {
    logMessage("err", `secrets dir missing: ${SECRETS_DIR}`);
    logMessage("err", "is chezmoi cloned to ~/.local/share/chezmoi?");
    return 1;
  }
  const existing = new Set<string>(
    readdirSync(SECRETS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  );
  logMessage("info", `${existing.size} secrets already encrypted at ${SECRETS_DIR}`);

  const totals = emptyCounters();
  for (const scanner of [
    scanEnvironment,
    scanGitHubCli,
    scanHishtory,
    scanDarwinKeychain,
    scanAwsCredentials,
    scanNpmrc,
  ]) {
    const res = scanner(existing);
    totals.wrote += res.wrote;
    totals.exists += res.exists;
    totals.empty += res.empty;
    totals.err += res.err;
  }

  logMessage(
    "info",
    `wrote ${totals.wrote} new · ${totals.exists} already-encrypted · ${totals.empty} not-in-env · ${totals.err} errors`,
  );
  return 0;
}

process.exit(main());
