// Netlify Background Function (the "-background" suffix gives it up to 15 minutes
// and an immediate 202 response). Extracts text from a validated manuscript,
// stores the normalized structure and searchable chunks, and records progress
// on the file record and an ai_tasks job row.
//
// Runs entirely as the signed-in author (their access token), so row-level
// security applies to every read and write. Safe to re-run: chunks for the file
// are replaced, never duplicated.

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { ExtractionError, extractManuscript } from './_shared/extract'
import { buildChunks } from '../../src/lib/documents/structure'
import { isManuscriptExt } from '../../src/lib/documents/validation'

const Body = z.object({ fileId: z.uuid() })
const STALE_MS = 10 * 60 * 1000

async function setStatus(db: SupabaseClient, fileId: string, patch: Record<string, unknown>) {
  await db.from('manuscript_files').update(patch).eq('id', fileId)
}

export async function runExtraction(db: SupabaseClient, userId: string, fileId: string): Promise<{ status: string; chunks?: number }> {
  const { data: file, error } = await db.from('manuscript_files').select('*').eq('id', fileId).maybeSingle()
  if (error) throw new HttpError(500, 'Could not load the file record.')
  if (!file) throw new HttpError(404, 'File not found.')
  if (file.upload_status !== 'validated') throw new HttpError(409, 'Only verified uploads can be extracted.')
  if (!isManuscriptExt(file.file_ext)) throw new HttpError(400, 'Unsupported file type.')
  if (file.extraction_status === 'processing' && Date.now() - new Date(file.updated_at).getTime() < STALE_MS) {
    return { status: 'already_running' }
  }

  const key = `extract:${fileId}`
  const { data: existing } = await db.from('ai_tasks').select('id, attempts').eq('idempotency_key', key).maybeSingle()
  const taskPatch = {
    task_type: 'extract_manuscript',
    status: 'running',
    book_id: file.book_id,
    manuscript_file_id: fileId,
    total_steps: 3,
    completed_steps: 0,
    error: null,
    started_at: new Date().toISOString(),
    completed_at: null,
  }
  const taskId = existing
    ? (await db.from('ai_tasks').update({ ...taskPatch, attempts: existing.attempts + 1 }).eq('id', existing.id).select('id').single()).data?.id
    : (await db.from('ai_tasks').insert({ ...taskPatch, idempotency_key: key, attempts: 1 }).select('id').single()).data?.id
  const step = (n: number) => taskId && db.from('ai_tasks').update({ completed_steps: n }).eq('id', taskId)

  await setStatus(db, fileId, { extraction_status: 'processing', error_message: null })

  try {
    const { data: blob, error: dlError } = await db.storage.from('manuscripts').download(file.storage_path)
    if (dlError || !blob) throw new ExtractionError('The stored file could not be read.')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await step(1)

    // Title, pen name and author name help recognize running headers and footers.
    const [{ data: book }, { data: profile }] = await Promise.all([
      db.from('books').select('title, subtitle, pen_name').eq('id', file.book_id).maybeSingle(),
      db.from('profiles').select('display_name, pen_names').eq('id', userId).maybeSingle(),
    ])
    const knownStrings = [book?.title, book?.subtitle, book?.pen_name, profile?.display_name, ...(profile?.pen_names ?? [])].filter(
      (s): s is string => typeof s === 'string' && s.trim().length >= 3,
    )
    const result = await extractManuscript(file.file_ext, bytes, { knownStrings })
    await step(2)

    if (result.needsOcr) {
      await db.from('manuscript_extractions').upsert({
        manuscript_file_id: fileId,
        book_id: file.book_id,
        format: result.format,
        detected_title: result.title,
        word_count: 0,
        character_count: 0,
        page_count: result.pageCount,
        chapter_count: 0,
        structure: [],
        warnings: result.warnings,
        needs_ocr: true,
      })
      await db.from('document_chunks').delete().eq('manuscript_file_id', fileId)
      await setStatus(db, fileId, { extraction_status: 'needs_ocr', extracted_at: new Date().toISOString(), error_message: result.warnings[0] })
      if (taskId) await db.from('ai_tasks').update({ status: 'completed', completed_steps: 3, completed_at: new Date().toISOString(), output: { needsOcr: true } }).eq('id', taskId)
      return { status: 'needs_ocr' }
    }
    if (result.wordCount === 0) throw new ExtractionError('No readable text was found in this file.')

    const { error: exError } = await db.from('manuscript_extractions').upsert({
      manuscript_file_id: fileId,
      book_id: file.book_id,
      format: result.format,
      detected_title: result.title,
      word_count: result.wordCount,
      character_count: result.characterCount,
      page_count: result.pageCount,
      chapter_count: result.chapters.length,
      structure: result.chapters,
      warnings: result.warnings,
      needs_ocr: false,
      cleanup: result.cleanup ?? null,
    })
    if (exError) throw new Error(`save extraction: ${exError.message}`)

    // Replace chunks so a re-run never duplicates them.
    await db.from('document_chunks').delete().eq('manuscript_file_id', fileId)
    const chunks = buildChunks(result.chapters)
    for (let i = 0; i < chunks.length; i += 100) {
      const rows = chunks.slice(i, i + 100).map((c) => ({
        owner_id: userId,
        manuscript_file_id: fileId,
        book_id: file.book_id,
        chunk_index: c.index,
        chapter_label: c.chapterLabel.slice(0, 200),
        content: c.content,
        char_start: c.charStart,
        char_end: c.charEnd,
        token_estimate: c.tokenEstimate,
      }))
      const { error: chunkError } = await db.from('document_chunks').insert(rows)
      if (chunkError) throw new Error(`save chunks: ${chunkError.message}`)
    }

    await setStatus(db, fileId, { extraction_status: 'completed', extracted_at: new Date().toISOString(), error_message: null })
    if (taskId)
      await db
        .from('ai_tasks')
        .update({
          status: 'completed',
          completed_steps: 3,
          completed_at: new Date().toISOString(),
          output: { chapters: result.chapters.length, words: result.wordCount, chunks: chunks.length, cleanup: result.cleanup },
        })
        .eq('id', taskId)
    return { status: 'completed', chunks: chunks.length }
  } catch (err) {
    // Never echo manuscript content in errors.
    const message = err instanceof ExtractionError ? err.message : 'Text extraction failed. Try again, or re-save the file and upload it again.'
    console.error('extraction failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
    await setStatus(db, fileId, { extraction_status: 'failed', error_message: message })
    if (taskId) await db.from('ai_tasks').update({ status: 'failed', error: message }).eq('id', taskId)
    return { status: 'failed' }
  }
}

export default handler(['POST'], async (req) => {
  const { user, db } = await requireUser(req)
  rateLimit(`extract:${user.id}`, 10, 0.1)
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'A valid fileId is required.')
  const result = await runExtraction(db, user.id, parsed.data.fileId)
  return json(result)
})

// Runs asynchronously for up to 15 minutes; the caller gets an empty 202 immediately.
export const config = { background: true }
