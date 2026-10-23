// Which AI providers the server can use, and the model catalog. Never returns key values.
// With ?check=1 it also tests each key against the provider (a free model-list call).
import { handler, json } from './_shared/http'
import { requireUser } from './_shared/auth'
import { rateLimit } from './_shared/rateLimit'
import { availableProviders, getProvider, keyFormatProblem, testProviderKey } from './_shared/ai'
import { MODELS } from '../../src/lib/ai/catalog'

export default handler(['GET'], async (req) => {
  const { user } = await requireUser(req)
  const check = new URL(req.url).searchParams.get('check') === '1'
  if (check) rateLimit(`ai-check:${user.id}`, 5, 0.05)
  const providers = availableProviders()
  const rows = await Promise.all(
    providers.map(async (id) => {
      const format = keyFormatProblem(id)
      return {
        id,
        capabilities: getProvider(id).getProviderCapabilities(),
        problem: format ?? (check ? await testProviderKey(id) : null),
        checked: check,
      }
    }),
  )
  return json({ providers: rows, models: MODELS.filter((m) => providers.includes(m.provider)) })
})
