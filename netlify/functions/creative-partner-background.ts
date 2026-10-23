// Netlify Background Function: runs the Full Creative Partner job for one book.
// Answers 202 at once; progress, plans and drafted scenes are stored in Supabase.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { runPartner } from './_shared/writing/partner'

const Body = z.object({
  bookId: z.uuid(),
  action: z.enum(['start', 'resume', 'approve_plan', 'restart']),
  input: z
    .object({
      concept: z.string().max(8000),
      direction: z.string().max(4000).default(''),
      chapters: z.number().int().min(1).max(60),
      scenesPerChapter: z.number().int().min(1).max(8),
      wordsPerScene: z.number().int().min(300).max(5000),
    })
    .nullable()
    .default(null),
})

export default handler(['POST'], async (req) => {
  const { user, db, token } = await requireUser(req)
  rateLimit(`partner:${user.id}`, 10, 0.1)
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'Invalid request.')
  const { bookId, action, input } = parsed.data
  const self = new URL(req.url)
  return json(
    await runPartner(db, bookId, action, input, {
      continueLater: async () => {
        await fetch(`${self.origin}/.netlify/functions/creative-partner-background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ bookId, action: 'resume' }),
        }).catch(() => undefined)
      },
    }),
  )
})

export const config = { background: true }
