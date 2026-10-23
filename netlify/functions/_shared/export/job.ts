// Run one export or restore recorded in the exports table. The app creates the row; this
// produces the file (or restores the uploaded backup) and records the result on the row.
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { HttpError } from '../http'
import { buildBackup, restoreBackup } from './backup'
import { buildDoc, CONTENT_LABELS, CONTENT_TYPES, type ExportOptions } from './builders'
import { slug } from './model'
import { MIME, render, type Format } from './render'

export const EXPORT_BUCKET = 'exports'

export const OptionsSchema = z.object({
  content: z.enum(CONTENT_TYPES),
  bookId: z.uuid().nullish(),
  seriesId: z.uuid().nullish(),
  chapterIds: z.array(z.uuid()).max(2000).optional(),
  characterIds: z.array(z.uuid()).max(2000).optional(),
})

const DOC_FORMATS = ['docx', 'epub', 'pdf', 'txt', 'md'] as const

interface ExportRow {
  id: string
  export_type: string
  format: string
  status: string
  options: Record<string, unknown>
  storage_path: string | null
}

export async function runExport(db: SupabaseClient, ownerId: string, exportId: string): Promise<{ status: string }> {
  const { data: row } = await db.from('exports').select('id, export_type, format, status, options, storage_path').eq('id', exportId).maybeSingle()
  if (!row) throw new HttpError(404, 'Export not found.')
  const r = row as ExportRow
  // Claim the row once; a second call for the same export does nothing.
  const claim = await db.from('exports').update({ status: 'processing', error_message: null }).eq('id', r.id).eq('status', 'pending').select('id')
  if (!claim.data?.length) return { status: 'already_running' }
  const fail = async (message: string) => {
    await db
      .from('exports')
      .update({ status: 'failed', error_message: message.slice(0, 1000), completed_at: new Date().toISOString() })
      .eq('id', r.id)
    return { status: 'failed' }
  }
  const progress = async (msg: string) => {
    await db
      .from('exports')
      .update({ result: { progress: msg } })
      .eq('id', r.id)
  }

  try {
    if (r.export_type === 'restore') {
      if (!r.storage_path || !r.storage_path.startsWith(`${ownerId}/imports/`)) return fail('The uploaded backup could not be found.')
      const { data: file, error } = await db.storage.from(EXPORT_BUCKET).download(r.storage_path)
      if (error || !file) return fail('The uploaded backup could not be read. Upload it again.')
      const result = await restoreBackup(db, ownerId, new Uint8Array(await file.arrayBuffer()), progress)
      // The uploaded copy is no longer needed once its contents are restored.
      await db.storage.from(EXPORT_BUCKET).remove([r.storage_path])
      await db.from('exports').update({ status: 'completed', storage_path: null, result, completed_at: new Date().toISOString() }).eq('id', r.id)
      return { status: 'completed' }
    }

    const parsed = OptionsSchema.safeParse({ ...r.options, content: r.export_type })
    if (!parsed.success) return fail('The export settings are not valid.')
    const o = parsed.data as ExportOptions
    let bytes: Uint8Array
    let name: string
    let mime: string
    let result: Record<string, unknown> = {}
    if (o.content === 'backup') {
      if (r.format !== 'zip') return fail('A project backup is a ZIP file.')
      const b = await buildBackup(db, ownerId, progress)
      bytes = b.zip
      result = { counts: b.counts }
      name = `author-studio-backup-${new Date().toISOString().slice(0, 10)}.zip`
      mime = MIME.zip
    } else {
      if (!(DOC_FORMATS as readonly string[]).includes(r.format)) return fail('Choose DOCX, EPUB, PDF, TXT or Markdown.')
      const doc = await buildDoc(db, o)
      const format = r.format as Format
      bytes = await render(doc, format, r.id)
      name = `${slug(doc.title)}.${format}`
      mime = MIME[format]
      result = { sections: doc.sections.length, label: CONTENT_LABELS[o.content] }
    }
    const path = `${ownerId}/${r.id}/${name}`
    const up = await db.storage.from(EXPORT_BUCKET).upload(path, bytes, { contentType: mime, upsert: true })
    if (up.error)
      return fail(
        /size|large/i.test(up.error.message) ? 'The file is larger than the 500 MB export limit.' : 'The file could not be saved. Try again.',
      )
    await db
      .from('exports')
      .update({
        status: 'completed',
        storage_path: path,
        file_name: name,
        size_bytes: bytes.byteLength,
        result,
        completed_at: new Date().toISOString(),
      })
      .eq('id', r.id)
    return { status: 'completed' }
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message)
    console.error('export failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 300) : 'unknown')
    return fail(
      r.export_type === 'restore' ? 'The backup could not be restored. Nothing was changed.' : 'The export could not be created. Try again.',
    )
  }
}
