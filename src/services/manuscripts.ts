import { MANUSCRIPT_BUCKET, supabase } from '@/lib/supabase/client'
import { buildStoragePath, validateManuscriptFile } from '@/lib/documents/validation'
import type { ManuscriptFile } from '@/types/db'
import { blocksToTiptap, type CleanupSummary, type ExtractedChapter } from '@/lib/documents/structure'
import { AppError, requireUserId, throwIfError } from './errors'
import { logActivity } from './books'

export async function listManuscripts(bookId: string): Promise<ManuscriptFile[]> {
  const { data, error } = await supabase
    .from('manuscript_files')
    .select('*')
    .eq('book_id', bookId)
    .order('created_at', { ascending: false })
  throwIfError(error)
  return (data ?? []) as ManuscriptFile[]
}

export async function listRecentUploads(limit = 5) {
  const { data, error } = await supabase
    .from('manuscript_files')
    .select('id, book_id, original_name, file_ext, size_bytes, upload_status, extraction_status, created_at, books!manuscript_files_book_fk(title)')
    .order('created_at', { ascending: false })
    .limit(limit)
  throwIfError(error)
  return (data ?? []) as unknown as Array<
    Pick<ManuscriptFile, 'id' | 'book_id' | 'original_name' | 'file_ext' | 'size_bytes' | 'upload_status' | 'extraction_status' | 'created_at'> & {
      books: { title: string } | null
    }
  >
}

export interface UploadOptions {
  bookId: string
  file: File
  kind: 'manuscript' | 'supporting'
}

/**
 * Upload flow:
 * 1. validate in the browser, 2. create a pending file record,
 * 3. upload straight to the private bucket, 4. ask the server to verify the
 * stored bytes, which marks the record validated or rejected.
 */
export async function uploadManuscript({ bookId, file, kind }: UploadOptions): Promise<ManuscriptFile> {
  const check = validateManuscriptFile(file.name, file.size)
  if (!check.ok) throw new AppError(check.error)

  const userId = await requireUserId()
  const id = crypto.randomUUID()
  const path = buildStoragePath(userId, bookId, id, file.name)

  const { count } = await supabase
    .from('manuscript_files')
    .select('id', { count: 'exact', head: true })
    .eq('book_id', bookId)
    .eq('kind', kind)

  const { error: insertError } = await supabase.from('manuscript_files').insert({
    id,
    book_id: bookId,
    kind,
    storage_path: path,
    original_name: file.name.slice(0, 255),
    file_ext: check.ext,
    mime_type: check.mime,
    size_bytes: file.size,
    version: (count ?? 0) + 1,
  })
  throwIfError(insertError)

  const { error: uploadError } = await supabase.storage
    .from(MANUSCRIPT_BUCKET)
    .upload(path, file, { contentType: check.mime, upsert: false })
  if (uploadError) {
    await supabase
      .from('manuscript_files')
      .update({ upload_status: 'failed', error_message: uploadError.message.slice(0, 500) })
      .eq('id', id)
    throw new AppError(`Upload failed: ${uploadError.message}`)
  }

  await supabase.from('manuscript_files').update({ upload_status: 'uploaded' }).eq('id', id)
  const verified = await verifyUpload(id)
  await logActivity('manuscript.uploaded', 'manuscript_file', id, { book_id: bookId })
  return verified
}

/** Server-side verification of a stored upload (type, size, signature). */
export async function verifyUpload(fileId: string): Promise<ManuscriptFile> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new AppError('You are signed out. Sign in again to continue.')

  let res: Response
  try {
    res = await fetch('/.netlify/functions/manuscript-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fileId }),
    })
  } catch {
    throw new AppError('The file was stored, but the server could not verify it. Use "Verify again" to retry.')
  }
  const body = (await res.json().catch(() => ({}))) as { file?: ManuscriptFile; error?: string }
  if (!res.ok || !body.file) {
    throw new AppError(body.error ?? 'The file was stored, but verification failed. Use "Verify again" to retry.')
  }
  return body.file
}

export async function getDownloadUrl(file: ManuscriptFile): Promise<string> {
  const { data, error } = await supabase.storage
    .from(MANUSCRIPT_BUCKET)
    .createSignedUrl(file.storage_path, 60, { download: file.original_name })
  throwIfError(error)
  return data!.signedUrl
}

export async function deleteManuscript(file: ManuscriptFile) {
  const { error: rmError } = await supabase.storage.from(MANUSCRIPT_BUCKET).remove([file.storage_path])
  throwIfError(rmError)
  const { error } = await supabase.from('manuscript_files').delete().eq('id', file.id)
  throwIfError(error)
  await logActivity('manuscript.deleted', 'manuscript_file', file.id, { book_id: file.book_id })
}

export async function setCurrentManuscript(bookId: string, fileId: string) {
  const { error } = await supabase.from('books').update({ current_manuscript_file_id: fileId }).eq('id', bookId)
  throwIfError(error)
}

// ---------------------------------------------------------------------------
// Phase 2: extraction and import
// ---------------------------------------------------------------------------
export interface ManuscriptExtraction {
  manuscript_file_id: string
  book_id: string
  format: string
  detected_title: string | null
  word_count: number
  character_count: number
  page_count: number | null
  chapter_count: number
  structure: ExtractedChapter[]
  warnings: string[]
  needs_ocr: boolean
  cleanup: CleanupSummary | null
  created_at: string
}

/** Queue text extraction. The background function answers immediately; progress shows on the file record. */
export async function requestExtraction(fileId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new AppError('You are signed out. Sign in again to continue.')
  const { error } = await supabase.from('manuscript_files').update({ extraction_status: 'queued', error_message: null }).eq('id', fileId)
  throwIfError(error)
  let res: Response
  try {
    res = await fetch('/.netlify/functions/extract-manuscript-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fileId }),
    })
  } catch {
    await supabase.from('manuscript_files').update({ extraction_status: 'failed', error_message: 'Could not reach the server.' }).eq('id', fileId)
    throw new AppError('Could not reach the server to start text extraction.')
  }
  if (!res.ok && res.status !== 202) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    await supabase.from('manuscript_files').update({ extraction_status: 'failed', error_message: body.error ?? 'Extraction could not start.' }).eq('id', fileId)
    throw new AppError(body.error ?? 'Extraction could not start.')
  }
}

export async function getExtraction(fileId: string): Promise<ManuscriptExtraction | null> {
  const { data, error } = await supabase.from('manuscript_extractions').select('*').eq('manuscript_file_id', fileId).maybeSingle()
  throwIfError(error)
  return data as ManuscriptExtraction | null
}

/** Turn selected extracted chapters into editable chapters and scenes after the book's existing ones. */
export interface ImportResult {
  imported: number
  replaced: number
  kept: number
}

/** Chapters previously imported from this file, and how many have been edited since. */
export async function previousImport(fileId: string): Promise<{ total: number; edited: number }> {
  const { data, error } = await supabase
    .from('chapters')
    .select('id, scenes(last_edited_at)')
    .eq('source_manuscript_file_id', fileId)
  throwIfError(error)
  const rows = (data ?? []) as Array<{ id: string; scenes: Array<{ last_edited_at: string | null }> }>
  return { total: rows.length, edited: rows.filter((r) => r.scenes.some((s) => s.last_edited_at)).length }
}

export async function importExtraction(fileId: string, chapters: ExtractedChapter[], replace = false): Promise<ImportResult> {
  const payload = chapters.map((c) => ({
    title: c.title,
    scenes: c.scenes.map((s, i) => ({ title: `Scene ${i + 1}`, content: blocksToTiptap(s.blocks), text: s.text })),
  }))
  const { data, error } = await supabase.rpc('import_manuscript', { p_file_id: fileId, p_chapters: payload, p_replace: replace })
  throwIfError(error)
  await logActivity('manuscript.imported', 'manuscript_file', fileId, { chapters: chapters.length, replace })
  return data as ImportResult
}
