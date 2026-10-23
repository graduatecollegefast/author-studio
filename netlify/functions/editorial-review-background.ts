// Netlify Background Function: runs or resumes an Editorial Studio review of a book's
// chapters for one review type. Runs as the signed-in author. Never edits manuscript text.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { runEditorial } from './_shared/editorial/job'
import { REVIEW_TYPES } from './_shared/editorial/prompts'

const Body = z.object({
  bookId: z.uuid(),
  reviewType: z.enum(REVIEW_TYPES),
  action: z.enum(['start', 'resume']).default('start'),
  chapterIds: z.array(z.uuid()).max(2000).nullish(),
})

export default handler(['POST'], async (req) => {
  const { user, db, token } = await requireUser(req)
  rateLimit(`editorial:${user.id}`, 10, 0.1)
  const parsed = Body.safeParse(await readJson(req, 128 * 1024))
  if (!parsed.success) throw new HttpError(400, 'A valid book and review type are required.')
  const { bookId, reviewType, action, chapterIds } = parsed.data
  const self = new URL(req.url)
  const result = await runEditorial(db, bookId, reviewType, action, chapterIds ?? null, {
    continueLater: async () => {
      await fetch(`${self.origin}/.netlify/functions/editorial-review-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookId, reviewType, action: 'resume' }),
      }).catch(() => undefined)
    },
  })
  return json(result)
})

export const config = { background: true }
