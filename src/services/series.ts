import { supabase } from '@/lib/supabase/client'
import type { Route } from '@/lib/ai/catalog'
import { AppError, throwIfError } from './errors'
import type { Finding } from './story'

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new AppError('You are signed out. Sign in again to continue.')
  let res: Response
  try {
    res = await fetch(`/.netlify/functions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AppError('Could not reach the server. Check your connection.')
  }
  if (res.status === 202) return {} as T
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new AppError(out.error ?? 'The server could not complete the request.')
  return out
}

export interface EarlierBook {
  id: string
  title: string
  order: number | null
  series: string
  approvedFacts: number
  pendingFacts: number
  words: number
}

export interface SharedCharacter {
  id: string
  name: string
  earlierBooks: string[]
  mentions: number
  earlierMentions: number
  linked: boolean
  facts: number
}

export interface SeriesScan {
  book: { id: string; title: string }
  series: Array<{ id: string; name: string; order: number | null }>
  earlier: EarlierBook[]
  shared: SharedCharacter[]
  duplicates: Array<{ name: string; ids: string[] }>
  chaptersToCheck: number
  estimate: { characters: number; chapters: number; costUsd: number; route: Route | null; allowed: boolean; reason?: string }
}

export const scanSeries = (bookId: string) => callFunction<SeriesScan>('series-review', { bookId })

export const startSeriesReview = (bookId: string, action: 'start' | 'resume', characterIds: string[] | null, includeChapters: boolean) =>
  callFunction('series-review-background', { bookId, action, characterIds, includeChapters })

export interface SeriesTask {
  id: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  output: { steps_total?: number; done?: string[]; findings?: number; unverified_dropped?: number; declined?: number; current?: string } | null
  error: string | null
  actual_cost_usd: number | null
  locked_at: string | null
  updated_at: string
  completed_at: string | null
}

export async function getSeriesTask(bookId: string): Promise<SeriesTask | null> {
  const { data, error } = await supabase
    .from('ai_tasks')
    .select('id, status, output, error, actual_cost_usd, locked_at, updated_at, completed_at')
    .eq('idempotency_key', `series_review:${bookId}`)
    .maybeSingle()
  throwIfError(error)
  return data as SeriesTask | null
}

export async function stopSeriesReview(taskId: string) {
  const { error } = await supabase.from('ai_tasks').update({ status: 'cancelled' }).eq('id', taskId).eq('status', 'running')
  throwIfError(error)
}

/** Findings from the series review, which are continuity findings for this book. */
export async function listSeriesFindings(bookId: string, taskId: string): Promise<Finding[]> {
  const { data, error } = await supabase
    .from('editorial_findings')
    .select(
      'id, book_id, chapter_id, scene_id, category, severity, description, original_evidence, original_location, conflicting_evidence, conflicting_location, suggested_resolution, status, author_note, canon_fact_ids, created_at, reviewed_at',
    )
    .eq('book_id', bookId)
    .eq('ai_task_id', taskId)
    .order('created_at')
    .limit(2000)
  throwIfError(error)
  return (data ?? []) as Finding[]
}

/** Record that these characters appear in this book, so the Story Bible and every check use them. */
export async function linkCharacters(bookId: string, characterIds: string[]) {
  if (!characterIds.length) return
  const { error } = await supabase.from('character_appearances').insert(characterIds.map((character_id) => ({ character_id, book_id: bookId })))
  throwIfError(error)
}
