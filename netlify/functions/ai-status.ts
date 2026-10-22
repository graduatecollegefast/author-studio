// Which AI providers the server can use, and the model catalog. Never returns key values.
import { handler, json } from './_shared/http'
import { requireUser } from './_shared/auth'
import { availableProviders, getProvider } from './_shared/ai'
import { MODELS } from '../../src/lib/ai/catalog'

export default handler(['GET'], async (req) => {
  await requireUser(req)
  const providers = availableProviders()
  return json({
    providers: providers.map((id) => ({ id, capabilities: getProvider(id).getProviderCapabilities() })),
    models: MODELS.filter((m) => providers.includes(m.provider)),
  })
})
