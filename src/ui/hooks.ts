import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ReadingSession } from '../speech/session'
import type { Syncer } from '../sync/syncer'

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

export function useSyncState(syncer: Syncer) {
  return useSyncExternalStore(syncer.subscribe, syncer.getState)
}
