import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { createStreamingSecretRedactor } from '@install-doctor/aid-core/redaction';

export interface ProcessRunOptions {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly terminationGraceMs?: number;
  readonly signal?: AbortSignal;
  readonly onOutput?: (stream: 'stdout' | 'stderr', line: string) => void;
  readonly inheritedFileDescriptors?: readonly number[];
}

function signalPosixGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}

async function waitForPosixGroupExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { process.kill(-pid, 0); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
      // Darwin can return EPERM for a negative-PID existence probe after the
      // same caller successfully delivered SIGKILL to that process group. The
      // successful group signal is the authoritative cleanup boundary there;
      // the heartbeat regression below still proves no runnable descendant
      // survives settlement.
      if (process.platform === 'darwin' && error instanceof Error && 'code' in error && error.code === 'EPERM') return;
      throw error;
    }
    if (Date.now() >= deadline) throw new Error('POSIX process group remained alive after forced termination');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function taskkill(pid: number, force: boolean, env: NodeJS.ProcessEnv): Promise<void> {
  const systemRoot = env.SystemRoot ?? process.env.SystemRoot;
  if (!systemRoot) throw new Error('SystemRoot is required to terminate a Windows process tree');
  const executable = `${systemRoot}\\System32\\taskkill.exe`;
  const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])];
  return new Promise((resolve, reject) => {
    const killer = spawn(executable, args, { env, shell: false, stdio: 'ignore', windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killer.kill('SIGKILL');
    }, 5_000);
    killer.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    killer.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('taskkill timed out while terminating the Windows process tree'));
      else if (code !== 0) reject(new Error(`taskkill exited ${String(code)} while terminating the Windows process tree`));
      else resolve();
    });
  });
}

export async function runProcess(options: ProcessRunOptions): Promise<number> {
  const graceMs = Math.min(30_000, Math.max(50, options.terminationGraceMs ?? 5_000));
  return new Promise((resolve, reject) => {
    const child = spawn(options.argv[0] ?? '', [...options.argv.slice(1)], {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: [
        'ignore', options.onOutput ? 'pipe' : 'ignore', options.onOutput ? 'pipe' : 'ignore',
        ...(options.inheritedFileDescriptors ?? []),
      ],
      windowsHide: true,
    });
    let settled = false;
    let terminationReason: 'timeout' | 'cancelled' | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    const windowsCleanupAttempts: Promise<void>[] = [];
    const buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const redactors = { stdout: createStreamingSecretRedactor(), stderr: createStreamingSecretRedactor() };
    const emitSafeText = (stream: 'stdout' | 'stderr', safeText: string): void => {
      buffers[stream] += safeText;
      const lines = buffers[stream].split(/\r?\n/);
      buffers[stream] = lines.pop() ?? '';
      for (const line of lines) options.onOutput?.(stream, line.slice(0, 16_384));
    };
    const emitChunk = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      emitSafeText(stream, redactors[stream].write(decoders[stream].write(chunk)));
    };
    child.stdout?.on('data', (chunk: Buffer) => emitChunk('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => emitChunk('stderr', chunk));
    const queueWindowsCleanup = (pid: number, force: boolean): void => {
      const attempt = taskkill(pid, force, options.env);
      // Attach immediately: a missing helper can reject before the child emits
      // close, but settlement still evaluates the original promise below.
      void attempt.catch(() => undefined);
      windowsCleanupAttempts.push(attempt);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (graceTimer) clearTimeout(graceTimer);
      options.signal?.removeEventListener('abort', cancel);
      if (windowsCleanupAttempts.length === 0) {
        action();
        return;
      }
      void Promise.allSettled(windowsCleanupAttempts).then(results => {
        if (results.every(result => result.status === 'rejected')) {
          const failure = results.at(-1);
          reject(failure?.status === 'rejected' ? failure.reason : new Error('Windows process-tree cleanup failed'));
          return;
        }
        action();
      });
    };
    const force = (): void => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') queueWindowsCleanup(child.pid, true);
        else signalPosixGroup(child.pid, 'SIGKILL');
      } catch (error) { finish(() => reject(error)); }
    };
    const terminate = (reason: 'timeout' | 'cancelled'): void => {
      if (terminationReason || settled) return;
      terminationReason = reason;
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') queueWindowsCleanup(child.pid, false);
        else signalPosixGroup(child.pid, 'SIGTERM');
        graceTimer = setTimeout(force, graceMs);
      } catch (error) { finish(() => reject(error)); }
    };
    const cancel = (): void => terminate('cancelled');
    const timeoutTimer = setTimeout(() => terminate('timeout'), options.timeoutMs);
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.once('error', error => finish(() => reject(error)));
    child.once('close', (code, signal) => {
      for (const stream of ['stdout', 'stderr'] as const) {
        emitSafeText(stream, redactors[stream].write(decoders[stream].end()));
        emitSafeText(stream, redactors[stream].end());
        if (buffers[stream]) options.onOutput?.(stream, buffers[stream].slice(0, 16_384));
      }
      if (terminationReason && process.platform !== 'win32' && child.pid) {
        // The process-group leader may exit promptly on SIGTERM while a
        // descendant ignores it. Do not let the leader's `close` event clear
        // the escalation timer and settle the operation with that descendant
        // still running.
        try { signalPosixGroup(child.pid, 'SIGKILL'); }
        catch (error) {
          // On Darwin the group can cross from our successfully signalled
          // child into kernel teardown between close and this escalation.
          // The existence probe below has the platform-specific EPERM rule;
          // other failures remain fatal.
          if (!(process.platform === 'darwin' && error instanceof Error && 'code' in error && error.code === 'EPERM')) {
            finish(() => reject(error));
            return;
          }
        }
        void waitForPosixGroupExit(child.pid, graceMs).then(
          () => finish(() => reject(new Error(`operation ${terminationReason} after process-tree cleanup`))),
          error => finish(() => reject(error)),
        );
        return;
      }
      finish(() => {
        if (terminationReason) reject(new Error(`operation ${terminationReason} after process-tree cleanup`));
        else if (signal) reject(new Error(`operation terminated by ${signal}`));
        else resolve(code ?? 1);
      });
    });
  });
}
