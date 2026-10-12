/** The pages the app can be written on. Notebook is the default. */
export const THEMES = [
  { id: 'light', name: 'Notebook' },
  { id: 'dark', name: 'Night' },
  { id: 'legal', name: 'Legal pad' },
  { id: 'squared', name: 'Squared' },
  { id: 'board', name: 'Blackboard' },
  { id: 'kraft', name: 'Brown paper' },
] as const

export type Theme = (typeof THEMES)[number]['id']

const THEME_KEY = 'out-loud:theme'

export function rememberedTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (THEMES.some((t) => t.id === saved)) return saved as Theme
  } catch {
    // remembering the choice is a convenience
  }
  return 'light'
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  // the browser's toolbar takes the page's colour
  const paper = getComputedStyle(root).getPropertyValue('--paper').trim()
  if (paper) document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', paper)
}

export function saveTheme(theme: Theme) {
  applyTheme(theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // the page still changes, it just won't be remembered
  }
}
