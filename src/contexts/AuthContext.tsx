import * as React from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  /** True after the user arrives from a password-reset email link. */
  recovering: boolean
  signOut: () => Promise<void>
}

const AuthContext = React.createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [recovering, setRecovering] = React.useState(false)

  React.useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
      setSession(next)
      setLoading(false)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = React.useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      recovering,
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, loading, recovering],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
