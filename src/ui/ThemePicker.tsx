import { useEffect, useRef, useState } from 'react'
import { rememberedTheme, saveTheme, THEMES, type Theme } from './theme'

/** A scrap of a page: its paper, rules and margin line. */
function Swatch({ theme }: { theme: Theme }) {
  return <span className="swatch" data-theme={theme} aria-hidden="true" />
}

/** The header button showing the current page; it opens the pages to choose from. */
export function ThemeMenu() {
  const [theme, setTheme] = useState<Theme>(rememberedTheme)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (t: Theme) => {
    setTheme(t)
    saveTheme(t)
  }
  return (
    <div className="theme-menu" ref={ref}>
      <button className="page-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Swatch theme={theme} />
        Page
      </button>
      {open && (
        <div className="theme-panel">
          <p id="theme-label">Choose a page</p>
          <div className="swatches" role="radiogroup" aria-labelledby="theme-label">
            {THEMES.map((t) => (
              <button key={t.id} role="radio" aria-checked={theme === t.id} onClick={() => choose(t.id)}>
                <Swatch theme={t.id} />
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
