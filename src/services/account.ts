import { supabase } from '@/lib/supabase/client'
import { AppError, throwIfError } from './errors'

const BUCKETS = ['manuscripts', 'covers', 'exports'] as const

/** Every stored file path under a folder, including subfolders. */
async function listAll(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error) throw new AppError(`Could not list your stored files: ${error.message}`)
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`
      if (item.id === null) out.push(...(await listAll(bucket, path)))
      else out.push(path)
    }
    if (!data || data.length < 1000) break
  }
  return out
}

/**
 * Permanently delete the signed-in account: stored files first (manuscripts, covers, exports),
 * then the account, which removes every book and record with it. Cannot be undone.
 */
export async function deleteAccount(userId: string): Promise<void> {
  for (const bucket of BUCKETS) {
    const paths = await listAll(bucket, userId)
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 100))
      if (error) throw new AppError(`Could not remove your stored files: ${error.message}`)
    }
  }
  const { error } = await supabase.rpc('delete_my_account')
  throwIfError(error)
  await supabase.auth.signOut({ scope: 'local' })
}
