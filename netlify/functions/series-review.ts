// Series review scan: earlier books in the series, characters shared with them, possible
// duplicate character records, and the cost of an AI review. Read only and free.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { scanSeries } from './_shared/series/review'

const Body = z.object({ bookId: z.uuid() })

export default handler(['POST'], async (req) => {
  const { user, db } = await requireUser(req)
  rateLimit(`series-scan:${user.id}`, 30, 0.5)
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'A valid bookId is required.')
  return json(await scanSeries(db, parsed.data.bookId))
})
