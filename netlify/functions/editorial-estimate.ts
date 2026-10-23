// Estimate the cost of an Editorial Studio review before it runs. Read only.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { estimateEditorial } from './_shared/editorial/job'
import { REVIEW_TYPES } from './_shared/editorial/prompts'

const Body = z.object({ bookId: z.uuid(), reviewType: z.enum(REVIEW_TYPES), chapterIds: z.array(z.uuid()).max(2000).nullish() })

export default handler(['POST'], async (req) => {
  const { user, db } = await requireUser(req)
  rateLimit(`editorial-estimate:${user.id}`, 30, 0.5)
  const parsed = Body.safeParse(await readJson(req, 128 * 1024))
  if (!parsed.success) throw new HttpError(400, 'A valid book and review type are required.')
  return json(await estimateEditorial(db, parsed.data.bookId, parsed.data.reviewType, parsed.data.chapterIds ?? null))
})
