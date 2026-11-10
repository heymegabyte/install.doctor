#!/usr/bin/env -S node --experimental-strip-types
/**
 * Cross-Platform Workstation Posture & Runtime Doctor (`workstation-doctor`).
 *
 * Executes live invariant checks across macOS (Darwin) and Linux workstations
 * (`macbook-pro`, `zen`, `omen`, `legion`, `ubuntu`), validating zero-Python
 * runtime services, loopback-only port bindings, Netdata zero-alarm posture,
 * CrowdSec firewall bouncer enforcement, ZRAM/ZFS storage safety, SUID core-dump
 * protection, LaunchAgent/systemd health, and Langfuse fail-open telemetry readiness.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { join } from "node:path";

interface DiagnosticFinding {
  readonly id: string;
  readonly severity: "critical" | "warning" | "info";
  readonly passed: boolean;
  readonly summary: string;
  readonly detail?: string;
}

interface WorkstationDoctorReport {
  readonly host: string;
  readonly platform: NodeJS.Platform;
  readonly generatedAt: string;
  readonly compliant: boolean;
  readonly criticalFailureCount: number;
  readonly warningFailureCount: number;
  readonly passedCount: number;
  readonly findings: readonly DiagnosticFinding[];
}

interface CommandExecutionOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const LOOPBACK_ONLY_PORTS: readonly number[] = [4880, 9835, 11434, 11435, 12345, 18080, 19999];

function runCommand(command: string, args: readonly string[], timeoutMs = 4_000): CommandExecutionOutcome {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function commandExists(binary: string): boolean {
  const out = runCommand("sh", ["-c", `command -v ${binary}`], 2_000);
  return out.status === 0 && out.stdout.trim().length > 0;
}

async function fetchJsonEndpoint(
  url: string,
  timeoutMs = 2_500,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> | null }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return { status: response.status, body: parsed };
    } catch {
      return { status: response.status, body: null };
    }
  } catch {
    return { status: 0, body: null };
  }
}

async function fetchStatusCode(url: string, timeoutMs = 2_500): Promise<number> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    await response.arrayBuffer();
    return response.status;
  } catch {
    return 0;
  }
}

async function checkSharedRuntimeServices(findings: DiagnosticFinding[]): Promise<void> {
  const proxyHealth = await fetchJsonEndpoint("http://127.0.0.1:4880/healthz");
  const proxyRuntime = proxyHealth.body?.runtime;
  findings.push({
    id: "local-artifact-proxy",
    severity: "critical",
    passed: proxyHealth.status === 200 && proxyRuntime === "node-typescript",
    summary: "Tier-1 local artifact proxy (:4880) healthy on Node TypeScript runtime",
    detail: `status=${proxyHealth.status}, runtime=${String(proxyRuntime ?? "unknown")}`,
  });

  const npmrcPath = join(homedir(), ".npmrc");
  const npmrcRaw = existsSync(npmrcPath) ? readFileSync(npmrcPath, "utf8") : "";
  const hasDeprecatedStoreDir = npmrcRaw
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith("store-dir="));
  findings.push({
    id: "npmrc-hygiene",
    severity: "warning",
    passed: !hasDeprecatedStoreDir,
    summary: "~/.npmrc free of pnpm-only store-dir key",
    detail: hasDeprecatedStoreDir ? "Found deprecated store-dir= in ~/.npmrc" : "clean",
  });

  const netdataAlarms = await fetchJsonEndpoint("http://127.0.0.1:19999/api/v1/alarms");
  let activeAlarmCount = -1;
  if (
    netdataAlarms.status === 200 &&
    netdataAlarms.body &&
    typeof netdataAlarms.body.alarms === "object" &&
    netdataAlarms.body.alarms !== null
  ) {
    const alarmEntries = Object.values(netdataAlarms.body.alarms as Record<string, Record<string, unknown>>);
    activeAlarmCount = alarmEntries.filter(
      (entry) => entry.recipient !== "silent" && entry.silenced !== true,
    ).length;
  }
  findings.push({
    id: "netdata-zero-alarms",
    severity: "critical",
    passed: netdataAlarms.status === 200 && activeAlarmCount === 0,
    summary: "Netdata (:19999) reachable with 0 active warning/critical alarms",
    detail: `status=${netdataAlarms.status}, activeAlarms=${activeAlarmCount}`,
  });

  const alloyStatus = await fetchStatusCode("http://127.0.0.1:12345/-/ready");
  findings.push({
    id: "grafana-alloy-ready",
    severity: "critical",
    passed: alloyStatus === 200,
    summary: "Grafana Alloy (:12345/-/ready) reporting ready",
    detail: `status=${alloyStatus}`,
  });

  if (commandExists("ollama")) {
    const ollamaVersion = await fetchStatusCode("http://127.0.0.1:11434/api/version");
    findings.push({
      id: "ollama-daemon",
      severity: "warning",
      passed: ollamaVersion === 200,
      summary: "Ollama loopback daemon (:11434) responsive",
      detail: `status=${ollamaVersion}`,
    });

    const tokenFile = join(homedir(), ".config", "megabyte", "ollama-gateway.token");
    if (existsSync(tokenFile)) {
      const authHealth = await fetchJsonEndpoint("http://127.0.0.1:11435/healthz");
      const unauthProbe = await fetchStatusCode("http://127.0.0.1:11435/api/version");
      findings.push({
        id: "ollama-auth-proxy",
        severity: "critical",
        passed:
          authHealth.status === 200 &&
          authHealth.body?.runtime === "node-typescript" &&
          unauthProbe === 401,
        summary: "Ollama authenticated gateway (:11435) running Node TypeScript and enforcing 401",
        detail: `health=${authHealth.status}, runtime=${String(authHealth.body?.runtime ?? "unknown")}, unauth=${unauthProbe}`,
      });
    }
  }

  const shimsDir = join(homedir(), ".cache", "cnf", "shims");
  let shimCount = 0;
  if (existsSync(shimsDir)) {
    try {
      shimCount = readdirSync(shimsDir).length;
    } catch {
      shimCount = 0;
    }
  }
  findings.push({
    id: "cnf-lazy-shims",
    severity: "warning",
    passed: shimCount >= 50,
    summary: "CNF lazy CLI shims directory populated",
    detail: `shimCount=${shimCount}`,
  });

  const langfusePingPath = join(homedir(), ".local", "bin", "langfuse-safe-ping");
  findings.push({
    id: "langfuse-safe-ping-installed",
    severity: "warning",
    passed: existsSync(langfusePingPath),
    summary: "Langfuse fail-open ping & spool replay CLI (~/.local/bin/langfuse-safe-ping) present",
    detail: langfusePingPath,
  });
}

function checkDarwinPosture(findings: DiagnosticFinding[]): void {
  const launchctlOut = runCommand("launchctl", ["list"], 4_000).stdout;
  const requiredLabels = [
    "space.megabyte.local-proxy",
    "space.megabyte.alloy",
    "space.megabyte.obs-relay",
    "space.megabyte.agent-skills-sync",
    "space.megabyte.langfuse-spool-drain",
    "space.megabyte.disk-hygiene",
    "space.megabyte.warp-keepalive",
    "sh.brew.netdata",
  ];
  const missingLabels = requiredLabels.filter((label) => !launchctlOut.includes(label));
  findings.push({
    id: "darwin-launchagents-loaded",
    severity: "critical",
    passed: missingLabels.length === 0,
    summary: "All required macOS LaunchAgents loaded",
    detail: missingLabels.length === 0 ? `loaded=${requiredLabels.length}` : `missing=${missingLabels.join(",")}`,
  });

  const lsofOut = runCommand("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], 5_000).stdout;
  const wildcardExposures: string[] = [];
  const pythonListeners: string[] = [];
  for (const line of lsofOut.split(/\r?\n/).slice(1)) {
    if (!line.trim()) {
      continue;
    }
    const cols = line.trim().split(/\s+/);
    const procName = cols[0] ?? "";
    const addrField = cols[8] ?? "";
    for (const port of LOOPBACK_ONLY_PORTS) {
      if (addrField.endsWith(`:${port}`)) {
        if (addrField.startsWith("*:") || addrField.startsWith("0.0.0.0:") || addrField.startsWith("[::]:")) {
          wildcardExposures.push(`${procName}@${addrField}`);
        }
        if (
          procName.toLowerCase().startsWith("python") &&
          port !== 19090 &&
          port !== 13100
        ) {
          pythonListeners.push(`${procName}@${addrField}`);
        }
      }
    }
  }

  findings.push({
    id: "darwin-loopback-bindings",
    severity: "critical",
    passed: wildcardExposures.length === 0,
    summary: "Loopback-only daemons not exposed on wildcard interfaces",
    detail: wildcardExposures.length === 0 ? "127.0.0.1-only" : wildcardExposures.join(", "),
  });

  findings.push({
    id: "darwin-zero-unexempted-python-daemons",
    severity: "critical",
    passed: pythonListeners.length === 0,
    summary: "Zero unexempted Python listeners on workstation daemon ports",
    detail: pythonListeners.length === 0 ? "0 unexempted Python listeners" : pythonListeners.join(", "),
  });

  const psOut = runCommand("ps", ["-eo", "pid,ppid,command"], 4_000).stdout;
  let orphanedCuaMcp = 0;
  for (const line of psOut.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const ppid = Number.parseInt(match[2] ?? "0", 10);
    const cmd = match[3] ?? "";
    if (ppid === 1 && cmd.includes("cua-driver mcp")) {
      orphanedCuaMcp += 1;
    }
  }
  findings.push({
    id: "darwin-cua-mcp-orphans",
    severity: "warning",
    passed: orphanedCuaMcp === 0,
    summary: "Zero orphaned ppid=1 cua-driver mcp processes",
    detail: `orphans=${orphanedCuaMcp}`,
  });

  const dfOut = runCommand("df", ["-Pk", "/System/Volumes/Data"], 3_000).stdout;
  const dfRow = dfOut.trim().split(/\r?\n/)[1] ?? "";
  const pctToken = dfRow.trim().split(/\s+/)[4] ?? "0%";
  const usedPct = Number.parseInt(pctToken.replace("%", ""), 10) || 0;
  findings.push({
    id: "darwin-apfs-capacity",
    severity: "warning",
    passed: usedPct < 90,
    summary: "macOS APFS /System/Volumes/Data utilization below 90%",
    detail: `used=${usedPct}%`,
  });
}

function readProcSys(relPath: string, sysctlKey: string): string {
  const procPath = `/proc/sys/${relPath}`;
  if (existsSync(procPath)) {
    try {
      return readFileSync(procPath, "utf8").trim();
    } catch {
      // Fall back to sysctl binary.
    }
  }
  return runCommand("/usr/sbin/sysctl", ["-n", sysctlKey]).stdout.trim();
}

async function checkLinuxPosture(findings: DiagnosticFinding[]): Promise<void> {
  const hwHealth = await fetchJsonEndpoint("http://127.0.0.1:9835/healthz");
  findings.push({
    id: "linux-hw-exporter",
    severity: "critical",
    passed: hwHealth.status === 200 && hwHealth.body?.runtime === "node-typescript",
    summary: "Workstation hardware exporter (:9835) healthy on Node TypeScript runtime",
    detail: `status=${hwHealth.status}, runtime=${String(hwHealth.body?.runtime ?? "unknown")}`,
  });

  const suidDumpable = readProcSys("fs/suid_dumpable", "fs.suid_dumpable");
  const corePattern = readProcSys("kernel/core_pattern", "kernel.core_pattern");
  const apportLoadState = runCommand("systemctl", ["show", "-P", "LoadState", "apport.service"]).stdout.trim();
  findings.push({
    id: "linux-coredump-hardening",
    severity: "critical",
    passed:
      suidDumpable === "0" &&
      corePattern === "|/bin/false" &&
      (apportLoadState === "masked" || apportLoadState === "not-found"),
    summary: "Kernel SUID core-dump protection active (fs.suid_dumpable=0, apport masked)",
    detail: `suid_dumpable=${suidDumpable}, core_pattern=${corePattern}, apport=${apportLoadState}`,
  });

  const fail2banLoad = runCommand("systemctl", ["show", "-P", "LoadState", "fail2ban.service"]).stdout.trim();
  const crowdsecState = runCommand("systemctl", ["is-active", "crowdsec.service"]).stdout.trim();
  const bouncerState = runCommand("systemctl", ["is-active", "crowdsec-firewall-bouncer.service"]).stdout.trim();
  findings.push({
    id: "linux-crowdsec-enforcement",
    severity: "critical",
    passed:
      (fail2banLoad === "masked" || fail2banLoad === "not-found") &&
      crowdsecState === "active" &&
      bouncerState === "active",
    summary: "CrowdSec engine and nftables firewall bouncer active (fail2ban masked)",
    detail: `crowdsec=${crowdsecState}, bouncer=${bouncerState}, fail2ban=${fail2banLoad}`,
  });

  const pulseHardeningPath = "/etc/systemd/system/pulse-agent.service.d/hardening.conf";
  if (existsSync(pulseHardeningPath)) {
    const firstLine = (readFileSync(pulseHardeningPath, "utf8").split(/\r?\n/, 1)[0] ?? "").trim();
    findings.push({
      id: "linux-pulse-hardening-clean",
      severity: "critical",
      passed: firstLine === "[Service]",
      summary: "pulse-agent hardening.conf header clean (no leaked stdin tokens)",
      detail: `firstLine=${firstLine === "[Service]" ? "[Service]" : "<corrupted>"}`,
    });
  }

  const swappiness = Number.parseInt(readProcSys("vm/swappiness", "vm.swappiness"), 10) || 0;
  const swapsRaw = existsSync("/proc/swaps") ? readFileSync("/proc/swaps", "utf8") : "";
  const zramActive = swapsRaw.includes("/dev/zram");
  findings.push({
    id: "linux-zram-swappiness-coherence",
    severity: "critical",
    passed: swappiness <= 60 || zramActive,
    summary: "Kernel vm.swappiness coherent with active ZRAM swap device",
    detail: `swappiness=${swappiness}, zramActive=${zramActive}`,
  });

  if (commandExists("zpool")) {
    const zpoolRows = runCommand("zpool", ["list", "-H", "-o", "name,cap,health,autotrim"]).stdout
      .trim()
      .split(/\r?\n/)
      .filter((r) => r.trim().length > 0);
    if (zpoolRows.length > 0) {
      const lsblkModels = runCommand("lsblk", ["-d", "-no", "MODEL"]).stdout;
      const hasSm951 = /MZHPV512HDGL/i.test(lsblkModels);
      const degradedPools: string[] = [];
      const sm951AutotrimViolations: string[] = [];
      for (const row of zpoolRows) {
        const [name, capRaw, health, autotrim] = row.trim().split(/\s+/);
        const cap = Number.parseInt((capRaw ?? "0").replace("%", ""), 10) || 0;
        if (health !== "ONLINE" || cap >= 88) {
          degradedPools.push(`${name}:${health}@${cap}%`);
        }
        if (hasSm951 && autotrim !== "off") {
          sm951AutotrimViolations.push(`${name}:autotrim=${autotrim}`);
        }
      }
      if (hasSm951) {
        const fstrimState = runCommand("systemctl", ["is-enabled", "fstrim.timer"]).stdout.trim();
        if (fstrimState === "enabled") {
          sm951AutotrimViolations.push("fstrim.timer:enabled");
        }
      }
      findings.push({
        id: "linux-zfs-pool-health",
        severity: "critical",
        passed: degradedPools.length === 0 && sm951AutotrimViolations.length === 0,
        summary: "OpenZFS pools ONLINE and hardware autotrim policy compliant",
        detail:
          degradedPools.length === 0 && sm951AutotrimViolations.length === 0
            ? `pools=${zpoolRows.length}, sm951=${hasSm951}`
            : [...degradedPools, ...sm951AutotrimViolations].join(", "),
      });
    }
  }

  if (commandExists("chronyc")) {
    const trackingOut = runCommand("chronyc", ["tracking"]).stdout;
    const leapNormal = /Leap status\s*:\s*Normal/i.test(trackingOut);
    findings.push({
      id: "linux-chrony-nts-sync",
      severity: "warning",
      passed: leapNormal,
      summary: "Chrony NTP/NTS clock discipline synchronized (Leap status: Normal)",
      detail: leapNormal ? "synchronized" : "unsynchronized",
    });
  }

  const failedUnitsOut = runCommand("systemctl", ["--failed", "--no-legend", "--plain"]).stdout.trim();
  const failedUnits = failedUnitsOut ? failedUnitsOut.split(/\r?\n/).filter((l) => l.trim().length > 0) : [];
  findings.push({
    id: "linux-systemd-zero-failed",
    severity: "critical",
    passed: failedUnits.length === 0,
    summary: "Zero failed system systemd units",
    detail: failedUnits.length === 0 ? "0 failed" : failedUnits.join("; "),
  });

  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  const userRuntimeDir = process.env.XDG_RUNTIME_DIR || (uid > 0 ? `/run/user/${uid}` : "");
  if (uid > 0 && userRuntimeDir && existsSync(`${userRuntimeDir}/bus`)) {
    const userFailedRes = spawnSync(
      "systemctl",
      ["--user", "--failed", "--no-legend", "--plain"],
      {
        encoding: "utf8",
        timeout: 8_000,
        env: {
          ...process.env,
          XDG_RUNTIME_DIR: userRuntimeDir,
          DBUS_SESSION_BUS_ADDRESS:
            process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${userRuntimeDir}/bus`,
        },
      },
    );
    const userFailedOut = (userFailedRes.stdout ?? "").trim();
    const userFailedUnits = userFailedOut
      ? userFailedOut.split(/\r?\n/).filter((l) => l.trim().length > 0)
      : [];
    findings.push({
      id: "linux-systemd-user-zero-failed",
      severity: "critical",
      passed: userFailedRes.status === 0 && userFailedUnits.length === 0,
      summary: "Zero failed user-scope systemd units",
      detail: userFailedUnits.length === 0 ? "0 failed" : userFailedUnits.join("; "),
    });
  }

  const ssOut = runCommand("ss", ["-H", "-lntu"]).stdout;
  const wildcardBindings: string[] = [];
  for (const row of ssOut.split(/\r?\n/)) {
    if (!row.trim()) {
      continue;
    }
    const cols = row.trim().split(/\s+/);
    const proto = cols[0] ?? "";
    const localAddr = cols[4] ?? "";
    for (const port of LOOPBACK_ONLY_PORTS) {
      if (localAddr.endsWith(`:${port}`)) {
        if (
          localAddr.startsWith("0.0.0.0:") ||
          localAddr.startsWith("*:") ||
          localAddr.startsWith("[::]:")
        ) {
          wildcardBindings.push(`${proto}:${localAddr}`);
        }
      }
    }
  }
  findings.push({
    id: "linux-loopback-port-isolation",
    severity: "critical",
    passed: wildcardBindings.length === 0,
    summary: "Loopback-only ports bound strictly to 127.0.0.1 / ::1 across TCP and UDP",
    detail: wildcardBindings.length === 0 ? "isolated" : wildcardBindings.join(", "),
  });
}

async function runWorkstationDoctor(): Promise<WorkstationDoctorReport> {
  const findings: DiagnosticFinding[] = [];
  const currentPlatform = platform();

  await checkSharedRuntimeServices(findings);
  if (currentPlatform === "darwin") {
    checkDarwinPosture(findings);
  } else if (currentPlatform === "linux") {
    await checkLinuxPosture(findings);
  }

  const criticalFailureCount = findings.filter((f) => !f.passed && f.severity === "critical").length;
  const warningFailureCount = findings.filter((f) => !f.passed && f.severity === "warning").length;
  const passedCount = findings.filter((f) => f.passed).length;

  return {
    host: hostname(),
    platform: currentPlatform,
    generatedAt: new Date().toISOString(),
    compliant: criticalFailureCount === 0,
    criticalFailureCount,
    warningFailureCount,
    passedCount,
    findings,
  };
}

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const strictMode = args.has("--strict");

const report = await runWorkstationDoctor();

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `Workstation Doctor — ${report.host} (${report.platform}) — compliant=${report.compliant} (passed=${report.passedCount}, critical=${report.criticalFailureCount}, warnings=${report.warningFailureCount})\n`,
  );
  for (const finding of report.findings) {
    const badge = finding.passed ? "PASS" : finding.severity === "critical" ? "FAIL" : "WARN";
    process.stdout.write(
      `  [${badge}] ${finding.id}: ${finding.summary}${finding.detail ? ` (${finding.detail})` : ""}\n`,
    );
  }
}

if (report.criticalFailureCount > 0 || (strictMode && report.warningFailureCount > 0)) {
  process.exit(1);
}
