// Models the app can route to, with list prices in USD per million tokens.
// Verified against the providers' published pricing pages on 2026-10-22:
//   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI:    https://developers.openai.com/api/docs/pricing
// Prices change; update this table when the providers do. Costs shown in the app are
// estimates from this table and the token counts the provider reports.

export type ProviderId = 'anthropic' | 'openai' | 'mock'

export interface ModelInfo {
  provider: ProviderId
  id: string
  label: string
  tier: 'economy' | 'standard' | 'premium'
  inputPerM: number
  outputPerM: number
  /** Higher rates above a prompt-length threshold (Claude Haiku 5.5 above 100K input tokens). */
  longContext?: { aboveInputTokens: number; inputPerM: number; outputPerM: number }
  /** Only listed where the provider documents it. */
  contextTokens?: number
  maxOutputTokens?: number
}

export const MODELS: ModelInfo[] = [
  {
    provider: 'anthropic',
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    tier: 'economy',
    inputPerM: 0.1,
    outputPerM: 0.5,
    longContext: { aboveInputTokens: 100_000, inputPerM: 0.5, outputPerM: 2.5 },
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
  },
  { provider: 'anthropic', id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'standard', inputPerM: 2, outputPerM: 10, contextTokens: 1_000_000, maxOutputTokens: 128_000 },
  { provider: 'anthropic', id: 'claude-opus-5-5', label: 'Claude Opus 5.5', tier: 'premium', inputPerM: 4, outputPerM: 20, contextTokens: 1_000_000, maxOutputTokens: 128_000 },
  { provider: 'openai', id: 'gpt-6-luna', label: 'GPT-6 Luna', tier: 'economy', inputPerM: 0.1, outputPerM: 0.5 },
  { provider: 'openai', id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', tier: 'standard', inputPerM: 2, outputPerM: 10 },
  { provider: 'openai', id: 'gpt-6-astra', label: 'GPT-6 Astra', tier: 'premium', inputPerM: 10, outputPerM: 50 },
  // Offline test double. Only reachable when the server sets AI_MOCK=1; never in production.
  { provider: 'mock', id: 'mock-small', label: 'Test model', tier: 'economy', inputPerM: 1, outputPerM: 5, contextTokens: 200_000, maxOutputTokens: 8_000 },
  { provider: 'mock', id: 'mock-large', label: 'Test model (large)', tier: 'standard', inputPerM: 2, outputPerM: 10, contextTokens: 200_000, maxOutputTokens: 8_000 },
]

/** Kinds of AI work, each routed to a model. Cheap models for extraction, stronger ones for judgment. */
export const TASK_TYPES = {
  book_extraction: { label: 'Reading chapters (characters, places, events)', defaultTier: 'economy' },
  book_synthesis: { label: 'Whole-book analysis (plot, themes, style, series ideas)', defaultTier: 'standard' },
  continuity_check: { label: 'Continuity checking (chapters against canon)', defaultTier: 'standard' },
  writing_assist: { label: 'Writing Studio edits and checks (rewrite, tension, POV, questions)', defaultTier: 'standard' },
  editorial_review: { label: 'Editorial Studio reviews (developmental, line, copy, dialogue, reader)', defaultTier: 'standard' },
  writing_draft: { label: 'Drafting new prose (continue, scenes, chapters, Creative Partner)', defaultTier: 'standard' },
  planning: { label: 'Planning (concept, premise, arcs, outline, scene plans)', defaultTier: 'standard' },
  style_analysis: { label: 'Writing style profiles', defaultTier: 'standard' },
  quick: { label: 'Quick tasks (deciding questions, idea connections, options)', defaultTier: 'economy' },
} as const
export type TaskType = keyof typeof TASK_TYPES

export interface Route {
  provider: ProviderId
  model: string
}

export function findModel(provider: string, model: string): ModelInfo | undefined {
  return MODELS.find((m) => m.provider === provider && m.id === model)
}

/** Pick the configured route if its provider is available, else the default tier on the first available provider. */
export function resolveRoute(task: TaskType, configured: Partial<Record<string, Route>> | null | undefined, available: ProviderId[]): Route | null {
  const c = configured?.[task]
  if (c && available.includes(c.provider) && findModel(c.provider, c.model)) return c
  const tier = TASK_TYPES[task].defaultTier
  for (const p of available) {
    const m = MODELS.find((x) => x.provider === p && x.tier === tier)
    if (m) return { provider: m.provider, model: m.id }
  }
  return null
}

export function costUsd(model: ModelInfo, inputTokens: number, outputTokens: number): number {
  const long = model.longContext && inputTokens > model.longContext.aboveInputTokens ? model.longContext : null
  const inRate = long ? long.inputPerM : model.inputPerM
  const outRate = long ? long.outputPerM : model.outputPerM
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000
}

/** Rough token estimate for planning. Newer tokenizers can produce more tokens; estimates lean high. */
export function estimateTokens(text: string | number): number {
  const chars = typeof text === 'number' ? text : text.length
  return Math.ceil(chars / 3.2)
}

export function formatUsd(n: number): string {
  if (n > 0 && n < 0.01) return '< $0.01'
  return `$${n.toFixed(2)}`
}
