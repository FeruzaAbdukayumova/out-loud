import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import * as library from './library/library'
import { httpApi } from './sync/api'
import { reportErrors } from './sync/reportErrors'
import { Syncer, localStorageTokens } from './sync/syncer'
import { App } from './ui/App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { applyTheme, rememberedTheme } from './ui/theme'

applyTheme(rememberedTheme())
registerSW({ immediate: true })

// without a server configured, the app works fully on its own, just without accounts
const api = import.meta.env.VITE_API_URL as string | undefined
const tokens = localStorageTokens()
const syncer = api ? new Syncer(httpApi(api), library, tokens) : null
if (api) reportErrors(api, () => tokens.get()?.token ?? null)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App syncer={syncer} />
    </ErrorBoundary>
  </StrictMode>,
)
