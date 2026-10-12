import { migrate, postgres, type Db } from '../db.ts'
import { pgliteDb } from '../pgliteDb.ts'

/**
 * A fresh, migrated database for a test. Uses a real Postgres when TEST_DATABASE_URL is set
 * (CI runs both), otherwise PGlite in memory.
 */
export async function testDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL
  const db = url ? postgres(url) : pgliteDb()
  if (url) await db.query('drop schema public cascade; create schema public')
  await migrate(db)
  return db
}
