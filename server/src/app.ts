import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import type { z } from 'zod'
import type { SessionResponse } from '../../shared/sync.ts'
import { EmailTaken, deleteUser, signIn, signOut, signUp, userForToken } from './auth.ts'
import type { Db } from './db.ts'
import { RateLimiter } from './rateLimit.ts'
import { clientError, signInBody, signUpBody, syncRequest } from './schema.ts'
import { sync } from './sync.ts'

export interface AppOptions {
  db: Db
  /** Origins allowed to call the API from a browser. */
  origins: string[]
  /** Auth attempts per IP per minute. */
  authLimit?: number
  /**
   * How many proxies in front of the server append to X-Forwarded-For (Render: 1). The client's
   * address is the entry that many places from the end; anything before it the client could
   * have written itself. 0 = not behind a proxy.
   */
  proxyHops?: number
  log?: (msg: string, extra?: Record<string, unknown>) => void
}

const MAX_ERROR_ROWS = 5000

type Env = { Variables: { user: { id: string; email: string }; token: string } }

export function createApp({ db, origins, authLimit = 10, proxyHops = 0, log = () => {} }: AppOptions) {
  const app = new Hono<Env>()
  const authLimiter = new RateLimiter(authLimit, 60_000)
  // per account too, so guessing one person's password from many addresses is still slow
  const emailLimiter = new RateLimiter(authLimit * 2, 15 * 60_000)
  const errorLimiter = new RateLimiter(20, 60_000)
  // error reports need no account, so they also get one limit for everyone together
  const allErrorsLimiter = new RateLimiter(300, 60_000)

  const ip = (c: Context) => {
    if (proxyHops === 0) return 'direct'
    const hops = c.req.header('x-forwarded-for')?.split(',').map((s) => s.trim()) ?? []
    return hops[hops.length - proxyHops] ?? 'unknown'
  }

  app.use(secureHeaders())
  app.use(cors({ origin: origins, allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'DELETE'], maxAge: 86400 }))
  app.use(bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: 'too-large' }, 413) }))

  const parse = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | null> => {
    const body = await c.req.json().catch(() => undefined)
    const result = schema.safeParse(body)
    return result.success ? result.data : null
  }

  const requireUser = async (c: Context<Env>, next: () => Promise<void>) => {
    const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
    const user = token ? await userForToken(db, token) : null
    if (!user || !token) return c.json({ error: 'signed-out' }, 401)
    c.set('user', user)
    c.set('token', token)
    await next()
  }

  app.get('/health', async (c) => {
    await db.query('select 1')
    return c.json({ ok: true })
  })

  app.post('/auth/signup', async (c) => {
    if (!authLimiter.allow(ip(c))) return c.json({ error: 'too-many' }, 429)
    const body = await parse(c, signUpBody)
    if (!body) return c.json({ error: 'invalid' }, 400)
    try {
      const { token } = await signUp(db, body.email, body.password)
      log('signup')
      return c.json({ token, email: body.email } satisfies SessionResponse, 201)
    } catch (e) {
      if (e instanceof EmailTaken) return c.json({ error: 'email-taken' }, 409)
      throw e
    }
  })

  app.post('/auth/signin', async (c) => {
    if (!authLimiter.allow(ip(c))) return c.json({ error: 'too-many' }, 429)
    const body = await parse(c, signInBody)
    if (!body) return c.json({ error: 'invalid' }, 400)
    if (!emailLimiter.allow(body.email)) return c.json({ error: 'too-many' }, 429)
    const session = await signIn(db, body.email, body.password)
    if (!session) return c.json({ error: 'wrong-credentials' }, 401)
    return c.json({ token: session.token, email: body.email } satisfies SessionResponse)
  })

  app.post('/auth/signout', requireUser, async (c) => {
    await signOut(db, c.get('token'))
    return c.body(null, 204)
  })

  app.get('/me', requireUser, (c) => c.json({ email: c.get('user').email }))

  app.delete('/me', requireUser, async (c) => {
    await deleteUser(db, c.get('user').id)
    log('account deleted')
    return c.body(null, 204)
  })

  app.post('/sync', requireUser, async (c) => {
    const body = await parse(c, syncRequest)
    if (!body) return c.json({ error: 'invalid' }, 400)
    return c.json(await sync(db, c.get('user').id, body))
  })

  /** Errors from the app in people's browsers, so they don't go unnoticed. */
  app.post('/errors', async (c) => {
    if (!errorLimiter.allow(ip(c)) || !allErrorsLimiter.allow('all')) return c.body(null, 204) // drop quietly
    const body = await parse(c, clientError)
    if (!body) return c.json({ error: 'invalid' }, 400)
    const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
    const user = token ? await userForToken(db, token) : null
    await db.query('insert into client_errors (user_id, message, stack, url, user_agent) values ($1, $2, $3, $4, $5)', [
      user?.id ?? null,
      body.message,
      body.stack ?? null,
      body.url ?? null,
      c.req.header('user-agent')?.slice(0, 500) ?? null,
    ])
    // keep the table bounded: only the most recent reports matter
    await db.query(`delete from client_errors where id <= (select max(id) - ${MAX_ERROR_ROWS} from client_errors)`)
    log('client error', { message: body.message })
    return c.body(null, 204)
  })

  app.notFound((c) => c.json({ error: 'not-found' }, 404))
  app.onError((err, c) => {
    log('server error', { message: err.message, stack: err.stack })
    return c.json({ error: 'server' }, 500)
  })

  return app
}
