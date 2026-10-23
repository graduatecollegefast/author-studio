// OpenAI Responses API adapter. Structured output uses text.format json_schema (strict).
// store: false so responses are not kept for later retrieval in the OpenAI dashboard.
import { type AIProvider, OutputTruncated, ProviderDeclined, ProviderError, parseJson, retryAfter, type StructuredRequest, type TextRequest } from './types'

const URL = 'https://api.openai.com/v1/responses'

interface ResponsesResponse {
  status?: string
  incomplete_details?: { reason?: string }
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { message?: string }
}

export function openaiProvider(apiKey: string, fetchImpl: typeof fetch = fetch): AIProvider {
  async function call(body: Record<string, unknown>) {
    let res: Response
    try {
      res = await fetchImpl(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ ...body, store: false }),
      })
    } catch {
      throw new ProviderError('Could not reach OpenAI.', true)
    }
    const data = (await res.json().catch(() => ({}))) as ResponsesResponse
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500
      const detail = (data.error?.message ?? '').slice(0, 200)
      const msg =
        res.status === 401
          ? `The OpenAI API key was rejected${detail ? ` (OpenAI says: ${detail})` : ''}. Check OPENAI_API_KEY in the Netlify environment variables.`
          : `OpenAI error ${res.status}: ${detail}`
      throw new ProviderError(msg, retryable, retryAfter(res), res.status)
    }
    const usage = { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 }
    const parts = (data.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? [])
    if (parts.some((p) => p.type === 'refusal')) throw new ProviderDeclined('OpenAI declined to analyze this passage.', usage)
    if (data.status === 'incomplete' && data.incomplete_details?.reason === 'max_output_tokens')
      throw new OutputTruncated(usage, parts.filter((p) => p.type === 'output_text').map((p) => p.text ?? '').join(''))
    if (data.status === 'incomplete' && data.incomplete_details?.reason === 'content_filter')
      throw new ProviderDeclined('OpenAI declined to analyze this passage.', usage)
    const text = parts.filter((p) => p.type === 'output_text').map((p) => p.text ?? '').join('')
    return { text, usage }
  }

  return {
    id: 'openai',
    async generateStructuredData<T>(req: StructuredRequest) {
      const { text, usage } = await call({
        model: req.model,
        instructions: req.system,
        input: req.input,
        max_output_tokens: req.maxOutputTokens,
        text: { format: { type: 'json_schema', name: req.schemaName, schema: req.schema, strict: true } },
      })
      return { data: parseJson<T>(text), usage }
    },
    async generateText(req: TextRequest) {
      return call({ model: req.model, instructions: req.system, input: req.input, max_output_tokens: req.maxOutputTokens })
    },
    getProviderCapabilities: () => ({ structuredOutput: true, streaming: true, declinesReported: true }),
  }
}
