// Claude Messages API adapter. Structured output uses output_config.format (JSON schema),
// per https://platform.claude.com/docs/en/build-with-claude/structured-outputs
import { type AIProvider, OutputTruncated, ProviderDeclined, ProviderError, parseJson, retryAfter, type StructuredRequest, type TextRequest } from './types'

const URL = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }>
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { type?: string; message?: string }
}

export function anthropicProvider(apiKey: string, fetchImpl: typeof fetch = fetch): AIProvider {
  async function call(body: Record<string, unknown>) {
    let res: Response
    try {
      res = await fetchImpl(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': VERSION },
        body: JSON.stringify(body),
      })
    } catch {
      throw new ProviderError('Could not reach Anthropic.', true)
    }
    const data = (await res.json().catch(() => ({}))) as MessagesResponse
    if (!res.ok) {
      const retryable = res.status === 429 || res.status === 529 || res.status >= 500
      const detail = (data.error?.message ?? '').slice(0, 200)
      const msg =
        res.status === 401
          ? `The Anthropic API key was rejected${detail ? ` (Anthropic says: ${detail})` : ''}. Check ANTHROPIC_API_KEY in the Netlify environment variables.`
          : res.status === 403
            ? `This Anthropic API key is not allowed to use this model${detail ? ` (Anthropic says: ${detail})` : ''}.`
            : `Anthropic error ${res.status}: ${detail}`
      throw new ProviderError(msg, retryable, retryAfter(res), res.status)
    }
    const usage = { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 }
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    if (data.stop_reason === 'refusal') throw new ProviderDeclined('Claude declined to analyze this passage.', usage)
    if (data.stop_reason === 'max_tokens') throw new OutputTruncated(usage)
    return { text, usage }
  }

  return {
    id: 'anthropic',
    async generateStructuredData<T>(req: StructuredRequest) {
      const { text, usage } = await call({
        model: req.model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.input }],
        output_config: { format: { type: 'json_schema', schema: req.schema } },
      })
      return { data: parseJson<T>(text), usage }
    },
    async generateText(req: TextRequest) {
      return call({ model: req.model, max_tokens: req.maxOutputTokens, system: req.system, messages: [{ role: 'user', content: req.input }] })
    },
    getProviderCapabilities: () => ({ structuredOutput: true, streaming: true, declinesReported: true }),
  }
}
