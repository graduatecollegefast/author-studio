// Estimated cost of analyzing a manuscript, shown before the author starts a job.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { estimateAnalysis } from './_shared/analysis/job'

const Body = z.object({ fileId: z.uuid() })

export default handler(['POST'], async (req) => {
  const { user, db } = await requireUser(req)
  rateLimit(`estimate:${user.id}`, 30, 0.5)
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'A valid fileId is required.')
  const e = await estimateAnalysis(db, parsed.data.fileId)
  const { settings: _s, ...rest } = e
  return json(rest)
})
