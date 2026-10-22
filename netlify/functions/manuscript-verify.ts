import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser, supabaseEnv } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { checkMagicBytes, isManuscriptExt, MAX_MANUSCRIPT_BYTES } from '../../src/lib/documents/validation'

const Body = z.object({ fileId: z.uuid() })
const HEAD_BYTES = 4096

/** Read the first bytes of a stored object and its total size, without downloading the whole file. */
export async function readObjectHead(url: string, token: string, apikey: string): Promise<{ head: Uint8Array; size: number | null }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, apikey, Range: `bytes=0-${HEAD_BYTES - 1}` },
  })
  if (res.status === 404 || res.status === 400) throw new HttpError(404, 'The uploaded file was not found in storage.')
  if (!res.ok) throw new HttpError(502, `Storage returned ${res.status}`)

  let size: number | null = null
  const range = res.headers.get('content-range')
  const m = range ? /\/(\d+)$/.exec(range) : null
  if (m) size = Number(m[1])
  else if (res.status === 200 && res.headers.get('content-length')) size = Number(res.headers.get('content-length'))

  const chunks: Uint8Array[] = []
  let total = 0
  const reader = res.body?.getReader()
  if (reader) {
    while (total < HEAD_BYTES) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      total += value.length
    }
    await reader.cancel().catch(() => undefined)
  }
  const head = new Uint8Array(Math.min(total, HEAD_BYTES))
  let offset = 0
  for (const c of chunks) {
    const take = Math.min(c.length, head.length - offset)
    head.set(c.subarray(0, take), offset)
    offset += take
    if (offset >= head.length) break
  }
  return { head, size }
}

export default handler(['POST'], async (req) => {
  const { user, token, db } = await requireUser(req)
  rateLimit(`verify:${user.id}`)

  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'A valid fileId is required.')

  // RLS: this only returns the row if it belongs to the caller.
  const { data: file, error } = await db.from('manuscript_files').select('*').eq('id', parsed.data.fileId).maybeSingle()
  if (error) throw new HttpError(500, 'Could not load the file record.')
  if (!file) throw new HttpError(404, 'File not found.')
  if (!String(file.storage_path).startsWith(`${user.id}/`)) throw new HttpError(403, 'Not allowed.')
  if (!isManuscriptExt(file.file_ext)) throw new HttpError(400, 'Unsupported file type.')

  const { url, anonKey } = supabaseEnv()
  const objectUrl = `${url}/storage/v1/object/authenticated/manuscripts/${String(file.storage_path)
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`

  let problem: string | null = null
  try {
    const { head, size } = await readObjectHead(objectUrl, token, anonKey)
    if (size !== null && size !== Number(file.size_bytes)) problem = 'The stored file size does not match the upload.'
    else if (size !== null && size > MAX_MANUSCRIPT_BYTES) problem = 'The file is larger than 100 MB.'
    else problem = checkMagicBytes(file.file_ext, head)
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) problem = err.message
    else throw err
  }

  const patch = problem
    ? { upload_status: 'rejected', error_message: problem }
    : { upload_status: 'validated', error_message: null }

  if (problem && !problem.startsWith('The uploaded file was not found')) {
    // Do not keep content that failed validation.
    await db.storage.from('manuscripts').remove([file.storage_path])
  }

  const { data: updated, error: updateError } = await db
    .from('manuscript_files')
    .update(patch)
    .eq('id', file.id)
    .select('*')
    .single()
  if (updateError) throw new HttpError(500, 'Could not update the file record.')

  return json({ file: updated })
})
