// Netlify Background Function: runs or resumes a continuity check for one book.
// Runs as the signed-in author (row-level security applies). Never edits canon or text.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { runContinuity } from './_shared/continuity/job'

const Body = z.object({ bookId: z.uuid(), action: z.enum(['start', 'resume', 'restart']).default('start') })

export default handler(['POST'], async (req) => {
  const { user, db, token } = await requireUser(req)
  rateLimit(`continuity:${user.id}`, 10, 0.1)
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'A valid bookId is required.')
  const { bookId, action } = parsed.data
  const self = new URL(req.url)
  const result = await runContinuity(db, bookId, action, {
    continueLater: async () => {
      await fetch(`${self.origin}/.netlify/functions/continuity-check-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookId, action: 'resume' }),
      }).catch(() => undefined)
    },
  })
  return json(result)
})

export const config = { background: true }
