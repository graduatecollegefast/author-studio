import { supabase } from '@/lib/supabase/client'
import type { ModelInfo, Route } from '@/lib/ai/catalog'
import { AppError, throwIfError } from './errors'

async function callFunction<T>(name: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new AppError('You are signed out. Sign in again to continue.')
  let res: Response
  try {
    res = await fetch(`/.netlify/functions/${name}`, {
      method: init.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new AppError('Could not reach the server. Check your connection.')
  }
  if (res.status === 202) return {} as T
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new AppError(body.error ?? 'The server could not complete the request.')
  return body
}

// ---------------------------------------------------------------------------
// Providers, settings, usage
// ---------------------------------------------------------------------------
export interface AIStatus {
  providers: Array<{ id: string; capabilities: { structuredOutput: boolean; streaming: boolean }; problem: string | null; checked: boolean }>
  models: ModelInfo[]
}
export const getAIStatus = (check = false) => callFunction<AIStatus>(check ? 'ai-status?check=1' : 'ai-status', { method: 'GET' })

export interface AISettingsRow {
  daily_limit_usd: number
  monthly_limit_usd: number
  max_task_usd: number
  routing: Partial<Record<string, Route>>
}
export const DEFAULT_AI_SETTINGS: AISettingsRow = { daily_limit_usd: 2, monthly_limit_usd: 20, max_task_usd: 1, routing: {} }

export async function getAISettings(): Promise<AISettingsRow> {
  const { data, error } = await supabase.from('ai_settings').select('daily_limit_usd, monthly_limit_usd, max_task_usd, routing').maybeSingle()
  throwIfError(error)
  if (!data) return DEFAULT_AI_SETTINGS
  return {
    daily_limit_usd: Number(data.daily_limit_usd),
    monthly_limit_usd: Number(data.monthly_limit_usd),
    max_task_usd: Number(data.max_task_usd),
    routing: (data.routing ?? {}) as AISettingsRow['routing'],
  }
}

export async function saveAISettings(s: AISettingsRow) {
  const { error } = await supabase.from('ai_settings').upsert(s, { onConflict: 'owner_id' })
  throwIfError(error)
}

export interface UsageRow {
  provider: string
  model: string
  task_type: string | null
  input_tokens: number
  output_tokens: number
  cost_usd: number
  created_at: string
}

/** This month's usage (UTC), plus totals for today and by model. */
export async function getUsageSummary(now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
  const { data, error } = await supabase
    .from('ai_usage')
    .select('provider, model, task_type, input_tokens, output_tokens, cost_usd, created_at')
    .gte('created_at', monthStart)
    .order('created_at', { ascending: false })
    .limit(20000)
  throwIfError(error)
  const rows = (data ?? []) as UsageRow[]
  const byModel = new Map<string, { provider: string; model: string; calls: number; input: number; output: number; cost: number }>()
  let today = 0
  let month = 0
  for (const r of rows) {
    const c = Number(r.cost_usd)
    month += c
    if (r.created_at >= dayStart) today += c
    const k = `${r.provider}/${r.model}`
    const m = byModel.get(k) ?? { provider: r.provider, model: r.model, calls: 0, input: 0, output: 0, cost: 0 }
    m.calls++
    m.input += r.input_tokens
    m.output += r.output_tokens
    m.cost += c
    byModel.set(k, m)
  }
  return { today, month, byModel: [...byModel.values()].sort((a, b) => b.cost - a.cost) }
}

// ---------------------------------------------------------------------------
// Book analysis
// ---------------------------------------------------------------------------
export interface AnalysisEstimate {
  bookTitle: string
  chunksTotal: number
  chunksRemaining: number
  synthesisRemaining: boolean
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  extraction: Route | null
  synthesis: Route | null
  providers: string[]
  spent: { today: number; month: number }
  taskSpent: number
  allowed: boolean
  reason?: string
}
export const estimateAnalysis = (fileId: string) => callFunction<AnalysisEstimate>('analysis-estimate', { body: { fileId } })

export async function startAnalysis(fileId: string, action: 'start' | 'resume' | 'restart') {
  await callFunction('analyze-book-background', { body: { fileId, action } })
}

export interface AnalysisTask {
  id: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  total_steps: number
  completed_steps: number
  output: {
    chunks_total?: number
    chunks_done?: number
    declined?: number
    failed?: number
    unverified_dropped?: number
    discoveries?: number
    synthesis_done?: boolean
    extraction_model?: string
    synthesis_model?: string
  } | null
  error: string | null
  estimated_cost_usd: number | null
  actual_cost_usd: number | null
  locked_at: string | null
  updated_at: string
  completed_at: string | null
}

export async function getAnalysisTask(fileId: string): Promise<AnalysisTask | null> {
  const { data, error } = await supabase
    .from('ai_tasks')
    .select('id, status, total_steps, completed_steps, output, error, estimated_cost_usd, actual_cost_usd, locked_at, updated_at, completed_at')
    .eq('idempotency_key', `analyze:${fileId}`)
    .maybeSingle()
  throwIfError(error)
  return data as AnalysisTask | null
}

export async function stopAnalysis(taskId: string) {
  const { error } = await supabase.from('ai_tasks').update({ status: 'cancelled' }).eq('id', taskId).eq('status', 'running')
  throwIfError(error)
}

// ---------------------------------------------------------------------------
// Discoveries (proposed canon) and review
// ---------------------------------------------------------------------------
export const DISCOVERY_CATEGORIES = [
  { id: 'character', label: 'Characters' },
  { id: 'relationship', label: 'Relationships' },
  { id: 'world', label: 'World' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'plot', label: 'Plot' },
  { id: 'theme', label: 'Themes' },
  { id: 'style', label: 'Writing style' },
  { id: 'series', label: 'Series ideas' },
] as const
export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number]['id']

export const STATEMENT_LABELS: Record<string, string> = {
  author_confirmed: 'Author confirmed',
  narrator: 'Narrator',
  character_statement: 'Character says',
  character_belief: 'Character believes',
  rumor: 'Rumor',
  dream: 'Dream',
  flashback: 'Flashback',
  ai_inference: 'AI inference',
  ai_suggestion: 'AI suggestion',
}

/** Statement types that never qualify for bulk approval, whatever the confidence. */
export const NOT_BULK_APPROVABLE = ['rumor', 'dream', 'character_belief', 'ai_suggestion']
export const HIGH_CONFIDENCE = 0.85

export interface FactSource {
  id: string
  location_label: string | null
  excerpt: string | null
  char_start: number | null
  char_end: number | null
  manuscript_file_id: string | null
  book_id: string | null
}

export interface Discovery {
  id: string
  book_id: string | null
  category: DiscoveryCategory | null
  entity_type: string
  entity_id: string | null
  entity_label: string | null
  attribute: string
  value: string
  statement_type: string
  status: 'proposed' | 'approved' | 'rejected' | 'superseded' | 'provisional'
  confidence: number | null
  payload: Record<string, unknown>
  approved_at: string | null
  created_at: string
  fact_sources: FactSource[]
}

const DISCOVERY_SELECT =
  'id, book_id, category, entity_type, entity_id, entity_label, attribute, value, statement_type, status, confidence, payload, approved_at, created_at, fact_sources(id, location_label, excerpt, char_start, char_end, manuscript_file_id, book_id)'

export async function listDiscoveries(bookId: string, status: string): Promise<Discovery[]> {
  const out: Discovery[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('canon_facts')
      .select(DISCOVERY_SELECT)
      .eq('book_id', bookId)
      .eq('status', status)
      .not('category', 'is', null)
      .order('category')
      .order('entity_label')
      .order('created_at')
      .range(from, from + 999)
    throwIfError(error)
    out.push(...((data ?? []) as unknown as Discovery[]))
    if (!data || data.length < 1000) break
  }
  return out.map((d) => ({ ...d, confidence: d.confidence === null ? null : Number(d.confidence) }))
}

export async function discoveryCounts(bookId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const status of ['proposed', 'approved', 'rejected']) {
    const { count, error } = await supabase
      .from('canon_facts')
      .select('id', { count: 'exact', head: true })
      .eq('book_id', bookId)
      .eq('status', status)
      .not('category', 'is', null)
    throwIfError(error)
    counts[status] = count ?? 0
  }
  return counts
}

export async function reviewDiscoveries(ids: string[], action: 'approve' | 'reject'): Promise<number> {
  let done = 0
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase.rpc('review_discoveries', { p_fact_ids: ids.slice(i, i + 500), p_action: action })
    throwIfError(error)
    done += Number((data as { updated?: number } | null)?.updated ?? 0)
  }
  return done
}

/** Correct a discovery before approving it. The change marks it as the author's own wording. */
export async function editDiscovery(id: string, patch: { entity_label?: string; value: string }) {
  const { error } = await supabase
    .from('canon_facts')
    .update({ ...patch, statement_type: 'author_confirmed', confidence: 1 })
    .eq('id', id)
    .eq('status', 'proposed')
  throwIfError(error)
}

export async function listPendingDiscoveryBooks(): Promise<Array<{ book_id: string; count: number }>> {
  const { data, error } = await supabase.from('canon_facts').select('book_id').eq('status', 'proposed').not('category', 'is', null).limit(10000)
  throwIfError(error)
  const m = new Map<string, number>()
  for (const r of data ?? []) if (r.book_id) m.set(r.book_id, (m.get(r.book_id) ?? 0) + 1)
  return [...m.entries()].map(([book_id, count]) => ({ book_id, count }))
}
