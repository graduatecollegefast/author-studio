// Unified AI service layer: provider selection, retries, usage records and spending limits.
import type { SupabaseClient } from '@supabase/supabase-js'
import { costUsd, findModel, type ProviderId, type Route, type TaskType } from '../../../../src/lib/ai/catalog'
import { anthropicProvider } from './anthropic'
import { mockProvider } from './mock'
import { openaiProvider } from './openai'
import { type AIProvider, OutputTruncated, ProviderDeclined, ProviderError, type StructuredRequest, type TextRequest, type Usage } from './types'

export * from './types'

/** Providers with a server-side key configured. Keys are read from the environment only. */
export function availableProviders(): ProviderId[] {
  if (process.env.AI_MOCK === '1') return ['mock']
  const out: ProviderId[] = []
  if (envKey('ANTHROPIC_API_KEY')) out.push('anthropic')
  if (envKey('OPENAI_API_KEY')) out.push('openai')
  return out
}

/**
 * Read a key from the environment, removing what copy and paste often adds:
 * surrounding spaces, line breaks, quote marks, or a "NAME=" prefix.
 */
export function cleanKey(raw: string | undefined, name?: string): string {
  let k = (raw ?? '').trim()
  if (name && k.startsWith(`${name}=`)) k = k.slice(name.length + 1).trim()
  k = k.replace(/^["'\u201C\u2018]+|["'\u201D\u2019]+$/g, '').trim()
  return k.replace(/\s+/g, '')
}

const envKey = (name: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY') => cleanKey(process.env[name], name)

/** A shape check only. It never reveals any part of the key. */
export function keyFormatProblem(provider: ProviderId): string | null {
  if (provider === 'anthropic') {
    const k = envKey('ANTHROPIC_API_KEY')
    if (k && !k.startsWith('sk-ant-'))
      return 'The ANTHROPIC_API_KEY value does not look like an Anthropic API key (those start with "sk-ant-"). Check that the right key was pasted.'
  }
  if (provider === 'openai') {
    const k = envKey('OPENAI_API_KEY')
    if (k && !k.startsWith('sk-')) return 'The OPENAI_API_KEY value does not look like an OpenAI API key (those start with "sk-").'
  }
  return null
}

export function getProvider(id: ProviderId): AIProvider {
  if (id === 'mock' && process.env.AI_MOCK === '1') return mockProvider()
  if (id === 'anthropic' && envKey('ANTHROPIC_API_KEY')) return anthropicProvider(envKey('ANTHROPIC_API_KEY'))
  if (id === 'openai' && envKey('OPENAI_API_KEY')) return openaiProvider(envKey('OPENAI_API_KEY'))
  throw new ProviderError(`The ${id} provider is not configured on the server.`, false)
}

export interface AISettings {
  daily_limit_usd: number
  monthly_limit_usd: number
  max_task_usd: number
  routing: Partial<Record<string, Route>>
}

export const DEFAULT_SETTINGS: AISettings = { daily_limit_usd: 2, monthly_limit_usd: 20, max_task_usd: 1, routing: {} }

export async function loadSettings(db: SupabaseClient): Promise<AISettings> {
  const { data } = await db.from('ai_settings').select('daily_limit_usd, monthly_limit_usd, max_task_usd, routing').maybeSingle()
  if (!data) return DEFAULT_SETTINGS
  return {
    daily_limit_usd: Number(data.daily_limit_usd),
    monthly_limit_usd: Number(data.monthly_limit_usd),
    max_task_usd: Number(data.max_task_usd),
    routing: (data.routing ?? {}) as AISettings['routing'],
  }
}

/** Spending is counted in UTC days and months. */
export async function spending(db: SupabaseClient, now = new Date()): Promise<{ today: number; month: number }> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const { data } = await db.from('ai_usage').select('cost_usd, created_at').gte('created_at', monthStart).limit(20000)
  let today = 0
  let month = 0
  for (const r of data ?? []) {
    const c = Number(r.cost_usd)
    month += c
    if (r.created_at >= dayStart) today += c
  }
  return { today, month }
}

export interface BudgetCheck {
  ok: boolean
  reason?: string
}

/** Would spending `next` more break a limit? `taskSpent` is what this job has already cost. */
export function checkBudget(settings: AISettings, spent: { today: number; month: number }, taskSpent: number, next: number): BudgetCheck {
  const fmt = (n: number) => `$${n.toFixed(2)}`
  if (spent.today + next > settings.daily_limit_usd)
    return { ok: false, reason: `Paused: this would pass your daily AI limit of ${fmt(settings.daily_limit_usd)}. Raise it in Settings, or resume tomorrow.` }
  if (spent.month + next > settings.monthly_limit_usd)
    return { ok: false, reason: `Paused: this would pass your monthly AI limit of ${fmt(settings.monthly_limit_usd)}. Raise it in Settings to continue.` }
  if (taskSpent + next > settings.max_task_usd)
    return { ok: false, reason: `Paused: this job would pass your per-job limit of ${fmt(settings.max_task_usd)}. Raise it in Settings, then resume.` }
  return { ok: true }
}

async function recordUsage(db: SupabaseClient, route: Route, taskType: TaskType, taskId: string | null, usage: Usage): Promise<number> {
  const model = findModel(route.provider, route.model)
  const cost = model ? costUsd(model, usage.inputTokens, usage.outputTokens) : 0
  await db.from('ai_usage').insert({
    ai_task_id: taskId,
    provider: route.provider,
    model: route.model,
    task_type: taskType,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: Number(cost.toFixed(6)),
  })
  return cost
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Call a provider for structured data with retries for rate limits and transient errors.
 * Every billed call is recorded in ai_usage, including declined and truncated ones.
 * A declined request is reported to the caller and never sent to another provider.
 */
export async function runStructured<T>(
  db: SupabaseClient,
  opts: { route: Route; taskType: TaskType; taskId: string | null; request: Omit<StructuredRequest, 'model'> },
): Promise<{ data: T; usage: Usage; cost: number }> {
  const provider = getProvider(opts.route.provider)
  let maxTokens = opts.request.maxOutputTokens
  let cost = 0
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await provider.generateStructuredData<T>({ ...opts.request, model: opts.route.model, maxOutputTokens: maxTokens })
      cost += await recordUsage(db, opts.route, opts.taskType, opts.taskId, r.usage)
      return { data: r.data, usage: r.usage, cost }
    } catch (err) {
      if (err instanceof ProviderDeclined) {
        cost += await recordUsage(db, opts.route, opts.taskType, opts.taskId, err.usage)
        ;(err as ProviderDeclined & { cost?: number }).cost = cost
        throw err
      }
      if (err instanceof OutputTruncated) {
        cost += await recordUsage(db, opts.route, opts.taskType, opts.taskId, err.usage)
        if (attempt >= 2) throw new ProviderError('The AI response was too long to finish.', false)
        maxTokens = Math.min(maxTokens * 2, 32_000)
        continue
      }
      const retryable = err instanceof ProviderError ? err.retryable : false
      if (!retryable || attempt >= 4) throw err
      const wait = (err as ProviderError).retryAfterMs ?? Math.min(20_000, 1000 * 2 ** attempt)
      await sleep(wait)
    }
  }
}

/**
 * Check a provider key without spending anything: list models, which every valid key may do.
 * Returns null when the key works, or a plain reason when it does not.
 */
export async function testProviderKey(provider: ProviderId, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (provider === 'mock') return null
  const name = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
  const key = envKey(name)
  if (!key) return `${name} is not set on the server.`
  const res = await fetchImpl(provider === 'anthropic' ? 'https://api.anthropic.com/v1/models?limit=1' : 'https://api.openai.com/v1/models', {
    headers: provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${key}` },
  }).catch(() => null)
  if (!res) return `Could not reach ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} from the server. Try again in a minute.`
  if (res.ok) return null
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  const detail = (body.error?.message ?? '').slice(0, 200)
  const who = provider === 'anthropic' ? 'Anthropic' : 'OpenAI'
  if (res.status === 401) return `${who} rejected the key${detail ? ` (${who} says: ${detail})` : ''}.`
  if (res.status === 403) return `${who} accepted the key but refused access${detail ? ` (${who} says: ${detail})` : ''}.`
  return `${who} answered with error ${res.status}${detail ? `: ${detail}` : ''}.`
}

/** Plain prose generation with the same retries, usage records and decline handling. */
export async function runText(
  db: SupabaseClient,
  opts: { route: Route; taskType: TaskType; taskId: string | null; request: Omit<TextRequest, 'model'> },
): Promise<{ text: string; usage: Usage; cost: number; truncated: boolean }> {
  const provider = getProvider(opts.route.provider)
  let cost = 0
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await provider.generateText({ ...opts.request, model: opts.route.model })
      cost += await recordUsage(db, opts.route, opts.taskType, opts.taskId, r.usage)
      return { text: r.text, usage: r.usage, cost, truncated: false }
    } catch (err) {
      if (err instanceof ProviderDeclined) {
        cost += await recordUsage(db, opts.route, opts.taskType, opts.taskId, err.usage)
        ;(err as ProviderDeclined & { cost?: number }).cost = cost
        throw err
      }
      if (err instanceof OutputTruncated) {
        // Prose cut at the length limit is still usable; the author sees it as a proposal.
        cost += await recordUsage(db, opts.route, opts.taskType, opts.taskId, err.usage)
        if (err.text.trim()) return { text: err.text, usage: err.usage, cost, truncated: true }
        throw Object.assign(new ProviderError('The response reached its length limit before finishing.', false), { cost })
      }
      const retryable = err instanceof ProviderError ? err.retryable : false
      if (!retryable || attempt >= 4) throw err
      await sleep((err as ProviderError).retryAfterMs ?? Math.min(20_000, 1000 * 2 ** attempt))
    }
  }
}

/** Estimated cost of one call, for budget checks before spending. */
export function callCost(route: Route, inputTokens: number, outputTokens: number): number {
  const m = findModel(route.provider, route.model)
  return m ? costUsd(m, inputTokens, outputTokens) : 0
}
