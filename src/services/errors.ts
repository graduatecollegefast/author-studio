import { supabase } from '@/lib/supabase/client'

interface MaybeError {
  message: string
  code?: string
}

export class AppError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

const FRIENDLY: Record<string, string> = {
  REVISION_CONFLICT: 'This scene was changed somewhere else since you opened it.',
  SCENE_NOT_FOUND: 'This scene no longer exists.',
  LAST_SCENE: 'A chapter needs at least one scene. Delete the chapter instead.',
  REORDER_MISMATCH: 'The order changed while you were moving items. Refresh and try again.',
  INVALID_MERGE: 'Choose at least one other character to merge.',
  CHARACTER_NOT_FOUND: 'One of these characters no longer exists. Refresh and try again.',
  INVALID_CONTENT: 'The editor content could not be saved because it was not valid.',
}

export function friendlyMessage(err: MaybeError): string {
  for (const key of Object.keys(FRIENDLY)) {
    if (err.message.includes(key)) return FRIENDLY[key]
  }
  if (err.code === '42501' || /row-level security/i.test(err.message)) {
    return 'You do not have access to this item.'
  }
  if (/Failed to fetch|NetworkError|network/i.test(err.message)) {
    return 'Could not reach the server. Check your connection.'
  }
  return err.message
}

export function throwIfError(error: MaybeError | null | undefined): asserts error is null | undefined {
  if (error) throw new AppError(friendlyMessage(error), error.code)
}

export async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new AppError('You are signed out. Sign in again to continue.')
  return id
}
