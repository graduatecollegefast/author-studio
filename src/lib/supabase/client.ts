import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Invite and password-recovery links arrive with the session in the URL hash.
// Read it before the client consumes it, so the app can ask for a password first.
export const arrivedToSetPassword =
  typeof window !== 'undefined' && /type=(invite|recovery)/.test(window.location.hash)

export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

export const MANUSCRIPT_BUCKET = 'manuscripts'
export const COVER_BUCKET = 'covers'
