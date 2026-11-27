/** @param {import('node:sqlite').DatabaseSync} sqlite */
export function sqliteD1Fixture(sqlite) {
  return {
    /** @param {string} sql */
    prepare(sql) {
      /** @type {import('node:sqlite').SQLInputValue[]} */
      let values = [];
      const statement = {
        /** @param {import('node:sqlite').SQLInputValue[]} bound */
        bind(...bound) { values = bound; return statement; },
        /** @template T @returns {Promise<T | null>} */
        async first() {
          const row = sqlite.prepare(sql).get(...values);
          return row ? /** @type {T} */ (/** @type {unknown} */ ({ ...row })) : null;
        },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  };
}
