/**
 * Sends uncaught errors to the server, so problems in people's browsers don't go unnoticed.
 * At most a few per page load, each message once.
 */
const MAX_PER_LOAD = 5

export function reportErrors(base: string, token: () => string | null): () => void {
  const sent = new Set<string>()
  const send = (message: string, stack?: string) => {
    if (sent.size >= MAX_PER_LOAD || sent.has(message)) return
    sent.add(message)
    const t = token()
    void fetch(base + '/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(t && { Authorization: `Bearer ${t}` }) },
      body: JSON.stringify({ message: message.slice(0, 1000), stack: stack?.slice(0, 8000), url: location.href.slice(0, 2000) }),
      keepalive: true,
    }).catch(() => {})
  }
  const onError = (e: ErrorEvent) => send(e.message || 'error', e.error instanceof Error ? e.error.stack : undefined)
  const onRejection = (e: PromiseRejectionEvent) => {
    const r: unknown = e.reason
    send(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined)
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  reportOne = send
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    reportOne = () => {}
  }
}

/** For errors React catches in an error boundary, which never reach window.onerror. */
export let reportOne: (message: string, stack?: string) => void = () => {}
