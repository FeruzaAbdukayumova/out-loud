import type { SessionResponse, SyncRequest, SyncResponse } from '../../shared/sync'

/** The server answered with an error, e.g. 'wrong-credentials', 'email-taken', 'signed-out'. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}
/** The server couldn't be reached (offline, or it timed out). */
export class NetworkError extends Error {}

export interface Api {
  signUp(email: string, password: string): Promise<SessionResponse>
  signIn(email: string, password: string): Promise<SessionResponse>
  signOut(token: string): Promise<void>
  deleteAccount(token: string): Promise<void>
  sync(token: string, req: SyncRequest): Promise<SyncResponse>
}

/**
 * The free server sleeps when idle and takes up to a minute to wake, so requests wait that long
 * before giving up.
 */
const TIMEOUT_MS = 70_000

export function httpApi(base: string): Api {
  async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    let res: Response
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new NetworkError()
    }
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(res.status, error ?? 'server')
    }
    return (res.status === 204 ? undefined : await res.json()) as T
  }

  return {
    signUp: (email, password) => call('POST', '/auth/signup', { email, password }),
    signIn: (email, password) => call('POST', '/auth/signin', { email, password }),
    signOut: (token) => call('POST', '/auth/signout', {}, token),
    deleteAccount: (token) => call('DELETE', '/me', undefined, token),
    sync: (token, req) => call('POST', '/sync', req, token),
  }
}
