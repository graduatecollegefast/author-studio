import { COVER_BUCKET, MANUSCRIPT_BUCKET, supabase } from '@/lib/supabase/client'
import { validateCoverFile, sanitizeFileName } from '@/lib/documents/validation'
import type { BookFormValues } from '@/lib/schemas'
import type { Book } from '@/types/db'
import { throwIfError, requireUserId } from './errors'

export async function listBooks(): Promise<Book[]> {
  const { data, error } = await supabase.from('books').select('*').order('updated_at', { ascending: false })
  throwIfError(error)
  return (data ?? []) as Book[]
}

export async function getBook(id: string): Promise<Book> {
  const { data, error } = await supabase.from('books').select('*').eq('id', id).single()
  throwIfError(error)
  return data as Book
}

export async function createBook(values: BookFormValues): Promise<Book> {
  const { data, error } = await supabase.from('books').insert(values).select('*').single()
  throwIfError(error)
  await logActivity('book.created', 'book', (data as Book).id)
  return data as Book
}

export async function updateBook(id: string, patch: Partial<BookFormValues> & Partial<Pick<Book, 'cover_path'>>) {
  const { data, error } = await supabase.from('books').update(patch).eq('id', id).select('*').single()
  throwIfError(error)
  return data as Book
}

export async function setArchived(id: string, archived: boolean) {
  const { data, error } = await supabase
    .from('books')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .single()
  throwIfError(error)
  await logActivity(archived ? 'book.archived' : 'book.restored', 'book', id)
  return data as Book
}

export async function markOpened(id: string) {
  const { error } = await supabase.from('books').update({ last_opened_at: new Date().toISOString() }).eq('id', id)
  throwIfError(error)
}

/** Remove every stored file under a folder prefix (storage list is not recursive). */
async function removeFolder(bucket: string, prefix: string) {
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100 })
    throwIfError(error)
    const files = (data ?? []).filter((f) => f.id !== null)
    if (files.length === 0) return
    const { error: rmError } = await supabase.storage.from(bucket).remove(files.map((f) => `${prefix}/${f.name}`))
    throwIfError(rmError)
    if (files.length < 100) return
  }
}

/** Permanently delete a book, its chapters, scenes, versions, file records, and stored files. */
export async function deleteBook(id: string) {
  const userId = await requireUserId()
  await removeFolder(MANUSCRIPT_BUCKET, `${userId}/${id}`)
  await removeFolder(COVER_BUCKET, `${userId}/${id}`)
  const { error } = await supabase.from('books').delete().eq('id', id)
  throwIfError(error)
  await logActivity('book.deleted', 'book', id)
}

export async function uploadCover(book: Book, file: File): Promise<Book> {
  const check = validateCoverFile(file.name, file.size)
  if (!check.ok) throw new Error(check.error)
  const userId = await requireUserId()
  const path = `${userId}/${book.id}/cover-${crypto.randomUUID()}-${sanitizeFileName(file.name)}`
  const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, file, { contentType: check.mime, upsert: false })
  throwIfError(error)
  const updated = await updateBook(book.id, { cover_path: path })
  if (book.cover_path) await supabase.storage.from(COVER_BUCKET).remove([book.cover_path])
  return updated
}

export async function getCoverUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(COVER_BUCKET).createSignedUrl(path, 60 * 60)
  if (error) return null
  return data.signedUrl
}

export async function logActivity(action: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  // Activity logging is best-effort and never blocks the user action.
  await supabase.from('activity_log').insert({ action, entity_type: entityType, entity_id: entityId, metadata })
}
