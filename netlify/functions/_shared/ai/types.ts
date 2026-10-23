import type { ProviderId } from '../../../../src/lib/ai/catalog'

export interface StructuredRequest {
  model: string
  system: string
  /** User content. Manuscript text must already be wrapped and labeled as data. */
  input: string
  /** JSON Schema for the response (objects closed, every property required). */
  schema: Record<string, unknown>
  schemaName: string
  maxOutputTokens: number
}

export interface TextRequest {
  model: string
  system: string
  input: string
  maxOutputTokens: number
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface StructuredResult<T> {
  data: T
  usage: Usage
}

export interface ProviderCapabilities {
  structuredOutput: boolean
  streaming: boolean
  /** Providers keep their own content policies; the app never routes a declined request elsewhere. */
  declinesReported: boolean
}

/** Common interface every provider adapter implements. Provider code never reaches the browser. */
export interface AIProvider {
  id: ProviderId
  generateStructuredData<T>(req: StructuredRequest): Promise<StructuredResult<T>>
  generateText(req: TextRequest): Promise<{ text: string; usage: Usage }>
  getProviderCapabilities(): ProviderCapabilities
}

/** The provider declined the request under its content policy. Not retried, not rerouted. */
export class ProviderDeclined extends Error {
  usage: Usage
  constructor(message: string, usage: Usage = { inputTokens: 0, outputTokens: 0 }) {
    super(message)
    this.name = 'ProviderDeclined'
    this.usage = usage
  }
}

/** A provider or network error. `retryable` covers rate limits, overload and transient server errors. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public retryAfterMs?: number,
    public status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** Output stopped at the token limit, so the JSON is incomplete. */
export class OutputTruncated extends Error {
  usage: Usage
  /** What was generated before the limit (useful for prose, not for JSON). */
  text: string
  constructor(usage: Usage, text = '') {
    super('The response was cut off at the output limit.')
    this.name = 'OutputTruncated'
    this.usage = usage
    this.text = text
  }
}

export function retryAfter(res: Response): number | undefined {
  const v = res.headers.get('retry-after')
  if (!v) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(60_000, n * 1000) : undefined
}

export function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    // Some models wrap JSON in a code fence despite a schema; strip it once.
    const m = /\{[\s\S]*\}/.exec(text)
    if (m) return JSON.parse(m[0]) as T
    throw new ProviderError('The AI response was not valid JSON.', true)
  }
}
