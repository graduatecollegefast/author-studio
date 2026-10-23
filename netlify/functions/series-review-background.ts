// Netlify Background Function: runs or resumes the series review for one book (shared
// characters and chapters against the earlier books). Runs as the signed-in author.
// Never edits text, canon or profiles; findings are suggestions for the author.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { runSeriesReview } from './_shared/series/review'

const Body = z.object({
  bookId: z.uuid(),
  action: z.enum(['start', 'resume']).default('start'),
  characterIds: z.array(z.uuid()).max(500).nullish(),
  includeChapters: z.boolean().default(true),
})

export default handler(['POST'], async (req) => {
  const { user, db, token } = await requireUser(req)
  rateLimit(`series-review:${user.id}`, 10, 0.1)
  const parsed = Body.safeParse(await readJson(req, 64 * 1024))
  if (!parsed.success) throw new HttpError(400, 'Invalid request.')
  const { bookId, action, characterIds, includeChapters } = parsed.data
  const self = new URL(req.url)
  const result = await runSeriesReview(
    db,
    bookId,
    action,
    { characterIds: characterIds ?? null, includeChapters },
    {
      continueLater: async () => {
        await fetch(`${self.origin}/.netlify/functions/series-review-background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ bookId, action: 'resume' }),
        }).catch(() => undefined)
      },
    },
  )
  return json(result)
})

export const config = { background: true }
