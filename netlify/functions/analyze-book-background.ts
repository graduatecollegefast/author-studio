// Netlify Background Function: runs or resumes AI analysis of one extracted manuscript.
// Answers 202 at once; progress lives on the ai_tasks row. Runs as the signed-in author,
// so row-level security applies to every read and write. Safe to call repeatedly: a lock
// keeps one run at a time, and finished passages are never analyzed twice.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { runAnalysis } from './_shared/analysis/job'

const Body = z.object({ fileId: z.uuid(), action: z.enum(['start', 'resume', 'restart']).default('start') })

export default handler(['POST'], async (req) => {
  const { user, db, token } = await requireUser(req)
  rateLimit(`analyze:${user.id}`, 10, 0.1)
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'A valid fileId is required.')
  const { fileId, action } = parsed.data
  const self = new URL(req.url)
  const result = await runAnalysis(db, fileId, action, {
    // Long books outlast one background run; hand off to a fresh run with the same session.
    continueLater: async () => {
      await fetch(`${self.origin}/.netlify/functions/analyze-book-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fileId, action: 'resume' }),
      }).catch(() => undefined)
    },
  })
  return json(result)
})

export const config = { background: true }
