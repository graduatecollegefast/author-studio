import { supabase } from '@/lib/supabase/client'
import { throwIfError } from './errors'

/** The author's calendar date, matching how the database buckets daily totals. */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export interface DailyStat {
  day: string
  words_added: number
  words_removed: number
}

export async function getDailyStats(days = 7): Promise<DailyStat[]> {
  const since = new Date()
  since.setDate(since.getDate() - (days - 1))
  const { data, error } = await supabase
    .from('writing_daily_stats')
    .select('day, words_added, words_removed')
    .gte('day', localDateString(since))
    .order('day', { ascending: true })
  throwIfError(error)
  return (data ?? []) as DailyStat[]
}

/** Net words for a day: words added minus words removed, never below zero. */
export function netWords(stat: DailyStat | undefined): number {
  if (!stat) return 0
  return Math.max(0, stat.words_added - stat.words_removed)
}

export function goalProgress(words: number, goal: number | null): { pct: number; met: boolean } | null {
  if (!goal || goal <= 0) return null
  return { pct: Math.min(100, Math.round((words / goal) * 100)), met: words >= goal }
}

/** Streak of consecutive days (ending today or yesterday) that met the goal. */
export function goalStreak(stats: DailyStat[], goal: number | null, today: string = localDateString()): number {
  if (!goal) return 0
  const met = new Set(stats.filter((s) => netWords(s) >= goal).map((s) => s.day))
  const cursor = new Date(`${today}T12:00:00`)
  if (!met.has(today)) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (met.has(localDateString(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
