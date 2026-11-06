import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PlatformProcessIdentity {
  readonly bootId: string;
  readonly processStart: string;
}

async function linuxProcessStart(pid: number): Promise<string | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const commandEnd = stat.lastIndexOf(')');
    if (commandEnd < 0) return undefined;
    const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
    // After removing pid and comm, field 3 (`state`) is index 0 and field 22
    // (`starttime`) is index 19.
    const startTime = fields[19];
    return startTime && /^\d+$/.test(startTime) ? `linux-jiffies:${startTime}` : undefined;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ESRCH')) return undefined;
    throw error;
  }
}

async function macosProcessStart(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 2_000,
    });
    const value = stdout.trim().replace(/\s+/g, ' ');
    return value ? `macos-lstart:${value}` : undefined;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 1 || error.code === 'ESRCH')) return undefined;
    throw error;
  }
}

export async function resolvePlatformProcessIdentity(pid = process.pid): Promise<PlatformProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('process identity requires a positive PID');
  if (process.platform === 'linux') {
    const [bootId, processStart] = await Promise.all([
      readFile('/proc/sys/kernel/random/boot_id', 'utf8').then(value => value.trim()),
      linuxProcessStart(pid),
    ]);
    if (!bootId || !processStart) throw new Error('unable to establish Linux boot and process-start identity');
    return { bootId: `linux-boot:${bootId}`, processStart };
  }
  if (process.platform === 'darwin') {
    const [{ stdout }, processStart] = await Promise.all([
      execFileAsync('/usr/sbin/sysctl', ['-n', 'kern.boottime'], {
        encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 2_000,
      }),
      macosProcessStart(pid),
    ]);
    const seconds = /sec\s*=\s*(\d+)/.exec(stdout)?.[1];
    if (!seconds || !processStart) throw new Error('unable to establish macOS boot and process-start identity');
    return { bootId: `macos-boot:${seconds}`, processStart };
  }
  throw new Error(`durable run ownership is unsupported on ${process.platform} without a protected native process-identity provider`);
}

export async function isPlatformProcessIdentityAlive(pid: number, expectedProcessStart: string): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  const actual = process.platform === 'linux'
    ? await linuxProcessStart(pid)
    : process.platform === 'darwin'
      ? await macosProcessStart(pid)
      : undefined;
  if (actual === undefined) {
    if (process.platform === 'linux' || process.platform === 'darwin') return false;
    // Unsupported platforms must not declare an owner dead and permit lease
    // theft without a protected native identity implementation.
    return true;
  }
  return actual === expectedProcessStart;
}
