import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { migrate, postgres, type Db } from './db.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const origins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim())
const port = Number(process.env.PORT ?? 8787)
// On Render a request reaches the service through Cloudflare's edge and then Render's own proxy,
// and X-Forwarded-For arrives as "<anything the client wrote>, client, cloudflare, render".
// Measured on the deployed service, not taken from docs.
const proxyHops = Number(process.env.PROXY_HOPS ?? (process.env.RENDER ? 3 : 0))

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...extra }))

// "memory": a throwaway in-process database, for local runs and end-to-end tests
const db: Db = url === 'memory' ? (await import('./pgliteDb.ts')).pgliteDb() : postgres(url)
const applied = await migrate(db)
if (applied.length) log('migrations applied', { applied })

const server = serve({ fetch: createApp({ db, origins, proxyHops, log }).fetch, port }, () => log('listening', { port }))

// Render sends SIGTERM on deploys: finish in-flight requests, then close the pool
process.on('SIGTERM', () => {
  server.close(() => void db.close().then(() => process.exit(0)))
})
