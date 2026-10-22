import * as React from 'react'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { DEFAULT_MODE } from '@/styles/tokens'

export const PAGE_WIDTHS = { narrow: '36rem', standard: '44rem', wide: '54rem' } as const

// Validated so a malformed row can never break the app; unknown keys are dropped.
const PreferencesSchema = z.object({
  theme: z.enum(['dark', 'light']).catch('dark'),
  fontScale: z.number().min(0.875).max(1.25).catch(1),
  highContrast: z.boolean().catch(false),
  reduceMotion: z.boolean().catch(false),
  writingMode: z.enum(['creative', 'focus', 'review']).catch(DEFAULT_MODE),
  manuscriptSize: z.number().min(15).max(28).catch(19),
  lineSpacing: z.number().min(1.4).max(2.4).catch(1.8),
  pageWidth: z.enum(['narrow', 'standard', 'wide']).catch('standard'),
  dailyWordGoal: z.number().int().min(10).max(50000).nullable().catch(null),
  timezone: z.string().max(64).optional().catch(undefined),
  /** When these preferences last changed; the newer of device and server copies wins. */
  updatedAt: z.string().max(40).optional().catch(undefined),
})

export type Preferences = z.infer<typeof PreferencesSchema>

export const DEFAULT_PREFERENCES: Preferences = PreferencesSchema.parse({})

const CACHE_KEY = 'author-studio:preferences'

export function parsePreferences(raw: unknown): Preferences {
  return PreferencesSchema.parse(raw && typeof raw === 'object' ? raw : {})
}

// The browser copy only exists so the right theme paints before the network
// answers. Supabase (profiles.preferences) is the source of truth.
function readCache(): Preferences {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return parsePreferences(JSON.parse(raw))
  } catch {
    // unavailable storage
  }
  return DEFAULT_PREFERENCES
}

function writeCache(p: Preferences) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(p))
  } catch {
    // unavailable storage
  }
}

interface Ctx {
  prefs: Preferences
  setPrefs: (patch: Partial<Preferences>) => void
  syncState: 'local' | 'saving' | 'saved' | 'error'
}

const PreferencesContext = React.createContext<Ctx | null>(null)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [prefs, setState] = React.useState<Preferences>(readCache)
  const [syncState, setSyncState] = React.useState<Ctx['syncState']>('local')
  const loadedFor = React.useRef<string | null>(null)
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = React.useCallback((userId: string, next: Preferences) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSyncState('saving')
    pending.current = { userId, next }
    saveTimer.current = setTimeout(async () => {
      pending.current = null
      const { error } = await supabase.from('profiles').update({ preferences: next, theme: next.theme }).eq('id', userId)
      setSyncState(error ? 'error' : 'saved')
    }, 500)
  }, [])

  // Send any pending change right away if the page is being hidden or closed.
  const pending = React.useRef<{ userId: string; next: Preferences } | null>(null)
  React.useEffect(() => {
    const flush = () => {
      const p = pending.current
      if (!p) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      pending.current = null
      void supabase.from('profiles').update({ preferences: p.next, theme: p.next.theme }).eq('id', p.userId)
    }
    const onHide = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  // Apply to the document.
  React.useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', prefs.theme === 'dark')
    root.classList.toggle('high-contrast', prefs.highContrast)
    root.classList.toggle('reduce-motion', prefs.reduceMotion)
    root.style.setProperty('--app-font-size', `${16 * prefs.fontScale}px`)
    writeCache(prefs)
  }, [prefs])

  // Load the signed-in author's saved preferences.
  React.useEffect(() => {
    if (!user || loadedFor.current === user.id) return
    loadedFor.current = user.id
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase.from('profiles').select('preferences').eq('id', user.id).maybeSingle()
      if (cancelled || error) return
      const server = parsePreferences(data?.preferences)
      const local = readCache()
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      // A change made on this device that never reached the server (closed tab mid-save) wins if newer.
      const localIsNewer = Boolean(local.updatedAt && (!server.updatedAt || local.updatedAt > server.updatedAt))
      const chosen = localIsNewer ? local : server
      setState(chosen)
      setSyncState('saved')
      // Daily word counts are bucketed in the author's time zone.
      if (localIsNewer || chosen.timezone !== timezone) persist(user.id, { ...chosen, timezone })
    })()
    return () => {
      cancelled = true
    }
  }, [user, persist])

  const setPrefs = React.useCallback(
    (patch: Partial<Preferences>) => {
      setState((p) => {
        const next = parsePreferences({ ...p, ...patch, updatedAt: new Date().toISOString() })
        if (user) persist(user.id, next)
        return next
      })
    },
    [user, persist],
  )

  const value = React.useMemo(() => ({ prefs, setPrefs, syncState }), [prefs, setPrefs, syncState])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): Ctx {
  const ctx = React.useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider')
  return ctx
}
