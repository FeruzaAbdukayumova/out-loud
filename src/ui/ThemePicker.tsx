import { useState } from 'react'
import { rememberedTheme, saveTheme, THEMES, type Theme } from './theme'

/** Which page to write on: each option shows a scrap of that paper. */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(rememberedTheme)
  const choose = (t: Theme) => {
    setTheme(t)
    saveTheme(t)
  }
  return (
    <section className="theme" aria-labelledby="theme-label">
      <span id="theme-label">Page</span>
      <div className="swatches" role="radiogroup" aria-labelledby="theme-label">
        {THEMES.map((t) => (
          <button key={t.id} role="radio" aria-checked={theme === t.id} onClick={() => choose(t.id)}>
            <span className="swatch" data-theme={t.id === 'auto' ? undefined : t.id} aria-hidden="true" />
            {t.name}
          </button>
        ))}
      </div>
    </section>
  )
}
