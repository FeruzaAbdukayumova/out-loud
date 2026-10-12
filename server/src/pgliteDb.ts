import { PGlite } from '@electric-sql/pglite'
import type { Db } from './db.ts'

/**
 * An in-memory Postgres (WebAssembly), for tests and for running the server locally without a
 * database (DATABASE_URL=memory). Everything is lost when the process ends.
 */
export function pgliteDb(): Db {
  const lite = new PGlite()
  // PGlite runs multi-statement SQL (migrations) through exec, and parameterised SQL through query
  const run = (q: Pick<PGlite, 'query' | 'exec'>) => (sql: string, params?: unknown[]) =>
    (params?.length ? q.query(sql, params) : q.exec(sql).then((r) => r.at(-1) ?? { rows: [] })) as never
  return {
    query: run(lite),
    transaction: (fn) => lite.transaction((tx) => fn({ query: run(tx) })),
    close: () => lite.close(),
  }
}
