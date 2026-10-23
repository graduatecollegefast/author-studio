import { supabase } from '@/lib/supabase/client'
import { AppError, throwIfError } from './errors'

export const EXPORT_BUCKET = 'exports'

export const EXPORT_CONTENT = [
  { id: 'manuscript', label: 'Complete manuscript', scope: 'book', formats: ['docx', 'epub', 'pdf', 'txt', 'md'] },
  { id: 'chapters', label: 'Selected chapters', scope: 'book', formats: ['docx', 'epub', 'pdf', 'txt', 'md'] },
  { id: 'outline', label: 'Book outline', scope: 'book', formats: ['docx', 'pdf', 'txt', 'md', 'epub'] },
  { id: 'character_profiles', label: 'Character profiles', scope: 'characters', formats: ['docx', 'pdf', 'txt', 'md', 'epub'] },
  { id: 'character_bible', label: 'Character Bible', scope: 'book', formats: ['docx', 'pdf', 'txt', 'md', 'epub'] },
  { id: 'world_bible', label: 'World Bible', scope: 'book', formats: ['docx', 'pdf', 'txt', 'md', 'epub'] },
  { id: 'series_overview', label: 'Series overview', scope: 'series', formats: ['docx', 'pdf', 'txt', 'md', 'epub'] },
  { id: 'timeline', label: 'Story timeline', scope: 'book', formats: ['docx', 'pdf', 'txt', 'md', 'epub'] },
  { id: 'notes', label: 'Project notes', scope: 'book', formats: ['docx', 'pdf', 'txt', 'md', 'epub'] },
  { id: 'backup', label: 'Complete project backup', scope: 'account', formats: ['zip'] },
] as const
export type ExportContent = (typeof EXPORT_CONTENT)[number]['id']
export type ExportFormat = 'docx' | 'epub' | 'pdf' | 'txt' | 'md' | 'zip'

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  docx: 'Word (DOCX)',
  epub: 'EPUB e-book',
  pdf: 'PDF',
  txt: 'Plain text (TXT)',
  md: 'Markdown',
  zip: 'ZIP backup',
}

export interface ExportRow {
  id: string
  book_id: string | null
  export_type: ExportContent | 'restore'
  format: ExportFormat | 'json'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  options: { bookId?: string | null; seriesId?: string | null; chapterIds?: string[]; characterIds?: string[] }
  storage_path: string | null
  file_name: string | null
  size_bytes: number | null
  error_message: string | null
  result: {
    progress?: string
    counts?: Record<string, number>
    files?: number
    files_missing?: number
    books?: Array<{ id: string; title: string }>
  } | null
  created_at: string
  completed_at: string | null
}

/** A job that has not finished within 20 minutes has stopped. */
export const isStalled = (r: ExportRow) =>
  (r.status === 'pending' || r.status === 'processing') && Date.now() - new Date(r.created_at).getTime() > 20 * 60 * 1000

async function trigger(exportId: string) {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new AppError('You are signed out. Sign in again to continue.')
  let res: Response
  try {
    res = await fetch('/.netlify/functions/export-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ exportId }),
    })
  } catch {
    throw new AppError('Could not reach the server. Check your connection.')
  }
  if (res.ok || res.status === 202) return
  const out = (await res.json().catch(() => ({}))) as { error?: string }
  throw new AppError(out.error ?? 'The server could not start the export.')
}

export async function listExports(): Promise<ExportRow[]> {
  const { data, error } = await supabase
    .from('exports')
    .select('id, book_id, export_type, format, status, options, storage_path, file_name, size_bytes, error_message, result, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(100)
  throwIfError(error)
  return (data ?? []) as ExportRow[]
}

export async function createExport(o: {
  content: ExportContent
  format: ExportFormat
  bookId?: string | null
  seriesId?: string | null
  chapterIds?: string[]
  characterIds?: string[]
}): Promise<string> {
  const id = crypto.randomUUID()
  const options = {
    bookId: o.bookId ?? null,
    seriesId: o.seriesId ?? null,
    ...(o.chapterIds?.length ? { chapterIds: o.chapterIds } : {}),
    ...(o.characterIds?.length ? { characterIds: o.characterIds } : {}),
  }
  const { error } = await supabase
    .from('exports')
    .insert({ id, book_id: o.bookId ?? null, export_type: o.content, format: o.format, options, status: 'pending' })
  throwIfError(error)
  await trigger(id)
  return id
}

/** Upload a backup ZIP and restore it as a copy. Nothing already in the account is replaced. */
export async function restoreBackup(file: File, userId: string): Promise<string> {
  if (!/\.zip$/i.test(file.name)) throw new AppError('Choose the .zip file that Author Studio created for your backup.')
  if (file.size > 500 * 1024 * 1024) throw new AppError('The backup is larger than 500 MB.')
  const id = crypto.randomUUID()
  const path = `${userId}/imports/${id}.zip`
  const up = await supabase.storage.from(EXPORT_BUCKET).upload(path, file, { contentType: 'application/zip', upsert: false })
  if (up.error) throw new AppError(up.error.message || 'The backup could not be uploaded.')
  const { error } = await supabase
    .from('exports')
    .insert({ id, export_type: 'restore', format: 'zip', storage_path: path, file_name: file.name, size_bytes: file.size, status: 'pending' })
  if (error) {
    await supabase.storage.from(EXPORT_BUCKET).remove([path])
    throwIfError(error)
  }
  await trigger(id)
  return id
}

/** Download a finished export through a short-lived private link. */
export async function downloadExport(r: ExportRow) {
  if (!r.storage_path) throw new AppError('This file is no longer available.')
  const { data, error } = await supabase.storage.from(EXPORT_BUCKET).createSignedUrl(r.storage_path, 60, { download: r.file_name ?? true })
  if (error || !data) throw new AppError('This file is no longer available. Create the export again.')
  const a = document.createElement('a')
  a.href = data.signedUrl
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Remove an entry from the download history, with its stored file. Your books are not affected. */
export async function deleteExport(r: ExportRow) {
  if (r.storage_path) await supabase.storage.from(EXPORT_BUCKET).remove([r.storage_path])
  const { error } = await supabase.from('exports').delete().eq('id', r.id)
  throwIfError(error)
}
