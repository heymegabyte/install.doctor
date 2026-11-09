export type SudoCleanupAction = 'check' | 'apply' | 'verify';

export async function executeSudoCredentialCleanup(input: {
  readonly action: SudoCleanupAction;
  readonly sudoPreexisting: boolean;
  readonly runExact: (argv: readonly ['-n', 'true'] | readonly ['-K'], environment: Readonly<Record<string, string>>) => Promise<number>;
}): Promise<number> {
  if (input.sudoPreexisting) return 0;
  const environment = Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C' });
  const active = async () => {
    const status = await input.runExact(['-n', 'true'], environment);
    if (status !== 0 && status !== 1) throw new Error(`sudo credential inspection failed with status ${status}`);
    return status === 0;
  };
  if (input.action === 'check') return await active() ? 10 : 0;
  if (input.action === 'verify') return await active() ? 30 : 0;
  if (!await active()) return 0;
  const result = await input.runExact(['-K'], environment);
  if (result !== 0) return result;
  return await active() ? 30 : 0;
}
