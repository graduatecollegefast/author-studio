import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { HttpError } from './http'

export function supabaseEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new HttpError(500, 'Server is missing Supabase configuration.')
  return { url, anonKey }
}

export interface AuthedRequest {
  user: User
  token: string
  /** Supabase client acting as the signed-in user. Row-level security applies to every query. */
  db: SupabaseClient
}

/**
 * Verify the caller's Supabase session. Never trusts an owner or user id from the
 * request body: identity always comes from the verified access token.
 */
export async function requireUser(req: Request): Promise<AuthedRequest> {
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) throw new HttpError(401, 'Sign in required.')
  const token = match[1].trim()
  const { url, anonKey } = supabaseEnv()
  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Your session has expired. Sign in again.')
  return { user: data.user, token, db }
}
