/**
 * Minimal ambient types for the node builtins the suite uses, so it compiles
 * with ONLY `typescript` (no @types/node dependency). Node provides the real
 * implementations at runtime; a full workspace install with @types/node would
 * exclude this file.
 */
declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
  interface StrictAssert {
    (value: unknown, message?: string | Error): void;
    ok(value: unknown, message?: string | Error): void;
    equal(actual: unknown, expected: unknown, message?: string | Error): void;
    deepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    match(value: string, regExp: RegExp, message?: string | Error): void;
    throws(fn: () => unknown, expected?: unknown, message?: string | Error): void;
    doesNotThrow(fn: () => unknown, message?: string | Error): void;
  }
  const assert: StrictAssert;
  export default assert;
}
