import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ReadingSession } from '../speech/session'

export const SessionContext = createContext<ReadingSession | null>(null)

export function useSession() {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession needs a SessionContext provider')
  return s
}

export function useSessionState() {
  const s = useSession()
  return useSyncExternalStore(s.subscribe, s.getState)
}
