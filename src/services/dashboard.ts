import { supabase } from '@/lib/supabase/client'
import { throwIfError } from './errors'

async function countRows(table: string, apply?: (q: any) => any): Promise<number> {
  let q = supabase.from(table).select('id', { count: 'exact', head: true })
  if (apply) q = apply(q)
  const { count, error } = await q
  throwIfError(error)
  return count ?? 0
}

export interface DashboardStats {
  totalWords: number
  activeBooks: number
  totalBooks: number
  chapters: number
  runningAiTasks: number
  openQuestions: number
  openContinuityWarnings: number
  aiSpendThisMonth: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [books, chapters, runningAiTasks, openQuestions, openContinuityWarnings, usage] = await Promise.all([
    supabase.from('books').select('word_count, archived_at, writing_status'),
    countRows('chapters'),
    countRows('ai_tasks', (q) => q.in('status', ['queued', 'running'])),
    countRows('clarification_questions', (q) => q.in('status', ['open', 'saved_for_later'])),
    countRows('editorial_findings', (q) => q.eq('review_type', 'continuity').eq('status', 'open')),
    supabase.from('ai_usage').select('cost_usd').gte('created_at', monthStart.toISOString()),
  ])
  throwIfError(books.error)
  throwIfError(usage.error)

  const rows = (books.data ?? []) as Array<{ word_count: number; archived_at: string | null; writing_status: string }>
  const live = rows.filter((b) => !b.archived_at)
  return {
    totalWords: live.reduce((sum, b) => sum + (b.word_count ?? 0), 0),
    activeBooks: live.filter((b) => ['drafting', 'revising', 'editing'].includes(b.writing_status)).length,
    totalBooks: live.length,
    chapters,
    runningAiTasks,
    openQuestions,
    openContinuityWarnings,
    aiSpendThisMonth: ((usage.data ?? []) as Array<{ cost_usd: number | string }>).reduce(
      (sum, r) => sum + Number(r.cost_usd ?? 0),
      0,
    ),
  }
}
