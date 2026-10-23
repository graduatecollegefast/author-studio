// Netlify Background Function: fills in one Writing Studio proposal (see _shared/writing/job).
// Runs as the signed-in author; the proposal is only text until the author accepts it.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { runWrite } from './_shared/writing/job'

const Body = z.object({ proposalId: z.uuid() })

export default handler(['POST'], async (req) => {
  const { user, db } = await requireUser(req)
  rateLimit(`write:${user.id}`, 20, 0.3)
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'A valid proposalId is required.')
  return json(await runWrite(db, parsed.data.proposalId))
})

export const config = { background: true }
