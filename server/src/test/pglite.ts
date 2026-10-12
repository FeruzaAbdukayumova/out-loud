import { PGlite } from '@electric-sql/pglite'
import { migrate, postgres, type Db } from '../db.ts'

/**
 * A fresh, migrated database for a test. Uses a real Postgres when TEST_DATABASE_URL is set
 * (CI runs both), otherwise PGlite in memory.
 */
export async function testDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL
  if (url) {
    const db = postgres(url)
    await db.query('drop schema public cascade; create schema public')
    await migrate(db)
    return db
  }
  const lite = new PGlite()
  const db: Db = {
    query: (sql, params) => (params?.length ? lite.query(sql, params) : lite.exec(sql).then((r) => r.at(-1) ?? { rows: [] })) as never,
    transaction: (fn) => lite.transaction((tx) => fn({ query: (sql, params) => (params?.length ? tx.query(sql, params) : tx.exec(sql).then((r) => r.at(-1) ?? { rows: [] })) as never })),
    close: () => lite.close(),
  }
  await migrate(db)
  return db
}
