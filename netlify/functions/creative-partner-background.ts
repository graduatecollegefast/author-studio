// Netlify Background Function: runs the Full Creative Partner job for one book.
// Answers 202 at once; progress, plans and drafted scenes are stored in Supabase.
// Because nobody sees a background function's response, any problem that stops the job
// from starting is written to the job record, where the app shows it.
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { partnerKey, runPartner } from './_shared/writing/partner'

// Numbers arrive from form inputs; out-of-range values are clamped by the job, never rejected.
const num = z.coerce.number().catch(0)
const Body = z.object({
  bookId: z.uuid(),
  action: z.enum(['start', 'resume', 'approve_plan', 'restart']),
  input: z
    .object({
      concept: z.string().max(20000),
      direction: z
        .string()
        .max(8000)
        .nullish()
        .transform((v) => v ?? ''),
      chapters: num,
      scenesPerChapter: num,
      wordsPerScene: num,
    })
    .nullable()
    .default(null),
})

async function recordProblem(db: SupabaseClient, bookId: string, message: string) {
  const key = partnerKey(bookId)
  const { data: task } = await db.from('ai_tasks').select('id, status, locked_at').eq('idempotency_key', key).maybeSingle()
  if (!task) {
    await db
      .from('ai_tasks')
      .insert({ task_type: 'creative_partner', idempotency_key: key, book_id: bookId, status: 'failed', error: message, input: {} })
  } else if (task.status !== 'running') {
    await db.from('ai_tasks').update({ error: message }).eq('id', task.id)
  }
}

export default handler(['POST'], async (req) => {
  const { user, db, token } = await requireUser(req)
  const raw = (await readJson(req, 64 * 1024).catch(() => null)) as { bookId?: unknown } | null
  const bookId = typeof raw?.bookId === 'string' && z.uuid().safeParse(raw.bookId).success ? raw.bookId : null
  try {
    rateLimit(`partner:${user.id}`, 10, 0.1)
    const parsed = Body.safeParse(raw)
    if (!parsed.success) {
      const tooLong = parsed.error.issues.find((i) => i.code === 'too_big')
      throw new HttpError(
        400,
        tooLong
          ? `The ${String(tooLong.path.at(-1))} is too long. Shorten it and start again.`
          : 'The Creative Partner request was not valid. Start again.',
      )
    }
    const { action, input } = parsed.data
    const self = new URL(req.url)
    return json(
      await runPartner(db, parsed.data.bookId, action, input, {
        continueLater: async () => {
          await fetch(`${self.origin}/.netlify/functions/creative-partner-background`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ bookId: parsed.data.bookId, action: 'resume' }),
          }).catch(() => undefined)
        },
      }),
    )
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'The Creative Partner could not start. Try again.'
    console.error('creative partner did not start', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
    if (bookId) await recordProblem(db, bookId, message).catch(() => undefined)
    throw err
  }
})

export const config = { background: true }
