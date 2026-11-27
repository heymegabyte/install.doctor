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
        first() {
          return new Promise(resolve => {
            const row = sqlite.prepare(sql).get(...values);
            resolve(row ? /** @type {T} */ (/** @type {unknown} */ ({ ...row })) : null);
          });
        },
        /** @returns {Promise<{meta: {changes: number}}>} */
        run() {
          return new Promise(resolve => {
            const result = sqlite.prepare(sql).run(...values);
            resolve({ meta: { changes: Number(result.changes) } });
          });
        },
      };
      return statement;
    },
  };
}
