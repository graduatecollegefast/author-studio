// What a continuity check of one book would compare, and its estimated cost.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { estimateContinuity } from './_shared/continuity/job'

const Body = z.object({ bookId: z.uuid() })

export default handler(['POST'], async (req) => {
  const { user, db } = await requireUser(req)
  rateLimit(`continuity-estimate:${user.id}`, 30, 0.5)
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'A valid bookId is required.')
  return json(await estimateContinuity(db, parsed.data.bookId))
})
