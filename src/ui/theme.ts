/** The pages the app can be written on. 'auto' follows the system's light or dark setting. */
export const THEMES = [
  { id: 'auto', name: 'Auto' },
  { id: 'light', name: 'Notebook' },
  { id: 'dark', name: 'Night' },
  { id: 'legal', name: 'Legal pad' },
  { id: 'squared', name: 'Squared' },
  { id: 'board', name: 'Blackboard' },
  { id: 'kraft', name: 'Brown paper' },
] as const

export type Theme = (typeof THEMES)[number]['id']

const THEME_KEY = 'out-loud:theme'
// the browser's toolbar colours for 'auto', as index.html sets them
const AUTO_BARS = ['#fbfbf8', '#131826']

export function rememberedTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (THEMES.some((t) => t.id === saved)) return saved as Theme
  } catch {
    // remembering the choice is a convenience
  }
  return 'auto'
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'auto') delete root.dataset.theme
  else root.dataset.theme = theme
  const paper = getComputedStyle(root).getPropertyValue('--paper').trim()
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta, i) => {
    meta.content = theme === 'auto' || !paper ? (AUTO_BARS[i] ?? AUTO_BARS[0]) : paper
  })
}

export function saveTheme(theme: Theme) {
  applyTheme(theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // the page still changes, it just won't be remembered
  }
}
