import { supabase } from '@/lib/supabase/client'
import type { Route } from '@/lib/ai/catalog'
import { ConflictError } from '@/lib/autosave'
import { docPlainText, replaceInDoc, type TNode } from '@/lib/editorial/replace'
import type { TiptapDoc } from '@/types/db'
import { logActivity } from './books'
import { createCheckpoint, getScene, saveScene } from './chapters'
import { AppError, throwIfError } from './errors'
import type { Finding, FindingStatus } from './story'

export const REVIEW_TYPES = [
  { id: 'developmental', label: 'Developmental', blurb: 'Structure, pacing, stakes, motivation, arcs and plot logic.' },
  { id: 'line', label: 'Line editing', blurb: 'Clarity, rhythm, word choice, redundancy and imagery, sentence by sentence.' },
  { id: 'copy', label: 'Copyediting', blurb: 'Grammar, spelling, punctuation, capitalization and consistency.' },
  { id: 'dialogue', label: 'Dialogue', blurb: 'Natural speech, distinct voices, tags, exposition and subtext.' },
  { id: 'continuity', label: 'Continuity', blurb: 'Contradictions with the approved canon of the book, series and universe.' },
  { id: 'reader', label: 'Reader perspective', blurb: 'How a first-time reader experiences it: confusion, engagement, emotion.' },
] as const
export type ReviewType = (typeof REVIEW_TYPES)[number]['id']

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

export interface EditorialEstimate {
  chapters: number
  words: number
  estimatedCostUsd: number
  route: Route | null
  allowed: boolean
  reason?: string
}

export const estimateReview = (bookId: string, reviewType: Exclude<ReviewType, 'continuity'>, chapterIds: string[] | null) =>
  callFunction<EditorialEstimate>('editorial-estimate', { bookId, reviewType, chapterIds })

export function startReview(bookId: string, reviewType: ReviewType, action: 'start' | 'resume', chapterIds: string[] | null) {
  if (reviewType === 'continuity') return callFunction('continuity-check-background', { bookId, action, chapterIds })
  return callFunction('editorial-review-background', { bookId, reviewType, action, chapterIds })
}

export interface ReviewTask {
  id: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  output: {
    chapters_total?: number
    done?: string[]
    findings?: number
    unverified_dropped?: number
    declined?: number
    chapter_ids?: string[] | null
  } | null
  error: string | null
  actual_cost_usd: number | null
  locked_at: string | null
  updated_at: string
  completed_at: string | null
}

export const reviewKey = (bookId: string, type: ReviewType) => (type === 'continuity' ? `continuity:${bookId}` : `editorial:${bookId}:${type}`)

export async function getReviewTask(bookId: string, type: ReviewType): Promise<ReviewTask | null> {
  const { data, error } = await supabase
    .from('ai_tasks')
    .select('id, status, output, error, actual_cost_usd, locked_at, updated_at, completed_at')
    .eq('idempotency_key', reviewKey(bookId, type))
    .maybeSingle()
  throwIfError(error)
  return data as ReviewTask | null
}

export async function stopReview(taskId: string) {
  const { error } = await supabase.from('ai_tasks').update({ status: 'cancelled' }).eq('id', taskId).eq('status', 'running')
  throwIfError(error)
}

export interface Revision {
  id: string
  scene_id: string
  base_revision: number
  original_text: string
  proposed_text: string
  status: 'pending' | 'accepted' | 'rejected' | 'edited' | 'generating' | 'failed'
}

export type EditorialFinding = Finding & { revision_proposals: Revision[] }

export async function listReviewFindings(bookId: string, type: ReviewType): Promise<EditorialFinding[]> {
  const { data, error } = await supabase
    .from('editorial_findings')
    .select(
      'id, book_id, chapter_id, scene_id, category, severity, description, original_evidence, original_location, conflicting_evidence, conflicting_location, suggested_resolution, status, author_note, canon_fact_ids, created_at, reviewed_at, revision_proposals(id, scene_id, base_revision, original_text, proposed_text, status)',
    )
    .eq('book_id', bookId)
    .eq('review_type', type)
    .order('created_at')
    .limit(5000)
  throwIfError(error)
  return (data ?? []) as EditorialFinding[]
}

export async function setReviewStatus(id: string, status: FindingStatus) {
  const { error } = await supabase
    .from('editorial_findings')
    .update({ status, reviewed_at: status === 'open' ? null : new Date().toISOString() })
    .eq('id', id)
  throwIfError(error)
}

/**
 * Apply one approved revision to its scene. The scene before the change is kept as a named
 * version, the change is saved as a new revision, and only the reviewed passage changes.
 */
export async function acceptRevision(findingId: string, rev: Revision, finalText?: string): Promise<void> {
  const text = (finalText ?? rev.proposed_text).trim()
  if (!text) throw new AppError('The revision is empty. Edit it or reject it instead.')
  const scene = await getScene(rev.scene_id)
  const next = replaceInDoc(scene.content as unknown as TNode, rev.original_text, text)
  if (!next)
    throw new AppError(
      'This passage has changed since the review, so the revision was not applied. Open the scene to edit it by hand, or reject the revision.',
    )
  await createCheckpoint(scene.id, 'Before editorial revision')
  try {
    await saveScene(scene.id, { content: next as unknown as TiptapDoc, text: docPlainText(next) }, scene.revision)
  } catch (e) {
    if (e instanceof ConflictError) throw new AppError('The scene was being edited at the same moment. Try again.')
    throw e
  }
  const edited = finalText !== undefined && finalText.trim() !== rev.proposed_text.trim()
  const { error } = await supabase
    .from('revision_proposals')
    .update({ status: edited ? 'edited' : 'accepted', ...(edited ? { proposed_text: text } : {}) })
    .eq('id', rev.id)
  throwIfError(error)
  await setReviewStatus(findingId, 'accepted')
  void logActivity('editorial_revision_accepted', 'scene', scene.id)
}

/** Reject a revision. The manuscript is not touched. */
export async function rejectRevision(findingId: string, rev: Revision) {
  const { error } = await supabase.from('revision_proposals').update({ status: 'rejected' }).eq('id', rev.id)
  throwIfError(error)
  await setReviewStatus(findingId, 'dismissed')
}
