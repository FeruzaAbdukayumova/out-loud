import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

/**
 * The little the app needs from a database. Production uses node-postgres; the tests use PGlite
 * (Postgres compiled to WebAssembly, in-process), so they run real SQL without a server.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  /** Runs `fn` in a transaction; it's rolled back if `fn` throws. */
  transaction<R>(fn: (tx: Queryable) => Promise<R>): Promise<R>
  close(): Promise<void>
}
export type Queryable = Pick<Db, 'query'>

export function postgres(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    // Neon and most hosted Postgres need TLS; a local database doesn't
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: true },
  })
  return {
    query: async (sql, params) => pool.query(sql, params as unknown[]) as never,
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await fn({ query: async (sql, params) => client.query(sql, params as unknown[]) as never })
        await client.query('commit')
        return result
      } catch (e) {
        await client.query('rollback')
        throw e
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

/** Applies the .sql files in `dir` that haven't run yet, in name order, each in its own transaction. */
export async function migrate(db: Db, dir = path.join(process.cwd(), 'migrations')): Promise<string[]> {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name))
  const applied: string[] = []
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue
    const sql = await readFile(path.join(dir, name), 'utf8')
    await db.transaction(async (tx) => {
      await tx.query(sql)
      await tx.query('insert into schema_migrations (name) values ($1)', [name])
    })
    applied.push(name)
  }
  return applied
}
