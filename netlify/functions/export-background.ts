// Netlify Background Function: creates an export file, or restores an uploaded project
// backup, for a row the author created in the exports table. Runs as the signed-in author.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { runExport } from './_shared/export/job'

const Body = z.object({ exportId: z.uuid() })

export default handler(['POST'], async (req) => {
  const { user, db } = await requireUser(req)
  rateLimit(`export:${user.id}`, 20, 0.2)
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'A valid exportId is required.')
  return json(await runExport(db, user.id, parsed.data.exportId))
})

export const config = { background: true }
