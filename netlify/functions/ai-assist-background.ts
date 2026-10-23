// Netlify Background Function: small AI jobs (decide a question, suggest options, connect an
// idea to projects, learn a style profile). Progress and errors live on an ai_tasks row.
import { z } from 'zod'
import { handler, HttpError, json, readJson } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { runAssist } from './_shared/writing/assist'

const Body = z.object({ kind: z.enum(['decide_question', 'question_options', 'idea_links', 'analyze_style']), id: z.uuid() })

export default handler(['POST'], async (req) => {
  const { user, db } = await requireUser(req)
  rateLimit(`assist:${user.id}`, 20, 0.3)
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) throw new HttpError(400, 'A valid kind and id are required.')
  return json(await runAssist(db, parsed.data.kind, parsed.data.id))
})

export const config = { background: true }
