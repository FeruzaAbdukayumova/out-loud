import { useEffect, useRef } from 'react'
import { useSession, useSessionState } from './hooks'

/** The mic button's dot, which grows with how loud the microphone hears you. */
export function MicDot() {
  const session = useSession()
  const { listening } = useSessionState()
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(
    () =>
      session.onLevel((level) => {
        if (ref.current) ref.current.style.transform = `scale(${1 + Math.min(level * 4, 1.2)})`
      }),
    [session],
  )
  // the meter stops without a last quiet reading, so settle the dot when listening ends
  useEffect(() => {
    if (!listening && ref.current) ref.current.style.transform = ''
  }, [listening])
  return <span className="dot" ref={ref} aria-hidden="true" />
}
