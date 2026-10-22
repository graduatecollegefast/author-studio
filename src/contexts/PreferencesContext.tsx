import * as React from 'react'

export type Theme = 'dark' | 'light'

export interface Preferences {
  theme: Theme
  fontScale: number // 0.875 to 1.25
  highContrast: boolean
  reduceMotion: boolean
  paperDark: boolean
}

const DEFAULTS: Preferences = { theme: 'dark', fontScale: 1, highContrast: false, reduceMotion: false, paperDark: false }
const KEY = 'author-studio:preferences'

// Display preferences are per-device conveniences, so they live in localStorage.
function load(): Preferences {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) }
  } catch {
    // ignore unavailable storage
  }
  return DEFAULTS
}

interface Ctx {
  prefs: Preferences
  setPrefs: (patch: Partial<Preferences>) => void
}

const PreferencesContext = React.createContext<Ctx | null>(null)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setState] = React.useState<Preferences>(load)

  React.useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', prefs.theme === 'dark')
    root.classList.toggle('high-contrast', prefs.highContrast)
    root.classList.toggle('reduce-motion', prefs.reduceMotion)
    root.style.setProperty('--app-font-size', `${16 * prefs.fontScale}px`)
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // ignore unavailable storage
    }
  }, [prefs])

  const setPrefs = React.useCallback((patch: Partial<Preferences>) => setState((p) => ({ ...p, ...patch })), [])
  const value = React.useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): Ctx {
  const ctx = React.useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider')
  return ctx
}
