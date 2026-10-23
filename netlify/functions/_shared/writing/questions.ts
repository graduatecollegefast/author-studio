// Clarification questions: stored per book, never asked twice.
import type { SupabaseClient } from '@supabase/supabase-js'

const STOP = new Set(
  'a an the and or but of to in on at for with is are was were be been do does did should would could will can this that these those it its his her their they them he she i you we what which who whom whose when where why how there here by from as into about than then so if'.split(
    ' ',
  ),
)

export function questionWords(q: string): string[] {
  return [...new Set(q.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)))].sort()
}

export function topicKey(q: string): string {
  return questionWords(q).join(' ')
}

/** Two questions ask the same thing when most of their meaningful words match. */
export function sameQuestion(a: string, b: string): boolean {
  const x = new Set(questionWords(a))
  const y = new Set(questionWords(b))
  if (!x.size || !y.size) return false
  let inter = 0
  for (const w of x) if (y.has(w)) inter++
  return inter / (x.size + y.size - inter) >= 0.6
}

export interface NewQuestion {
  question: string
  context?: string
  options?: string[]
}

/** Store new questions for a book, skipping any that repeat one already asked (answered or not). */
export async function insertQuestions(db: SupabaseClient, bookId: string, taskId: string | null, questions: NewQuestion[]): Promise<number> {
  const { data: existing } = await db.from('clarification_questions').select('question').eq('book_id', bookId).limit(2000)
  const seen = (existing ?? []).map((e) => e.question as string)
  const rows: Array<Record<string, unknown>> = []
  for (const q of questions.slice(0, 12)) {
    const text = String(q.question ?? '').trim().slice(0, 500)
    if (text.length < 8 || seen.some((s) => sameQuestion(s, text))) continue
    seen.push(text)
    rows.push({
      book_id: bookId,
      ai_task_id: taskId,
      question: text,
      context: String(q.context ?? '').trim().slice(0, 1000) || null,
      options: (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim().slice(0, 300)).filter(Boolean).slice(0, 5),
      topic_key: topicKey(text),
    })
  }
  if (!rows.length) return 0
  const { error } = await db.from('clarification_questions').insert(rows)
  if (error) throw new Error(`save questions: ${error.message}`)
  return rows.length
}

export const QUESTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'context', 'options'],
        properties: { question: { type: 'string' }, context: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
} as const
