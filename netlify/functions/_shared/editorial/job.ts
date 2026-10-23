// Editorial review of selected chapters (or the whole book) for one review type. Resumable
// chapter by chapter. Findings and suggested revisions are only proposals: nothing here
// edits manuscript text. The author approves or rejects each revision in the app.
import type { SupabaseClient } from '@supabase/supabase-js'
import { costUsd, estimateTokens, findModel, resolveRoute, type Route } from '../../../../src/lib/ai/catalog'
import { HttpError } from '../http'
import { availableProviders, checkBudget, loadSettings, ProviderDeclined, ProviderError, runStructured, spending } from '../ai'
import { locateExcerpt } from '../analysis/evidence'
import { EDITORIAL_SCHEMA, editorialInput, editorialSystem, REVIEW_BRIEFS, type EditorialOutput, type ReviewType } from './prompts'

const STALE_LOCK_MS = 5 * 60 * 1000
const RUN_BUDGET_MS = 11 * 60 * 1000
const CONCURRENCY = 3
const MAX_CHAPTER_CHARS = 120_000
const EST_OUTPUT = 2500

export const editorialKey = (bookId: string, type: ReviewType) => `editorial:${bookId}:${type}`

interface Scene {
  id: string
  title: string
  position: number
  content_text: string
  revision: number
}
interface Chapter {
  id: string
  title: string
  position: number
  scenes: Scene[]
}
type Span = { scene: Scene; start: number; end: number }

export function chapterText(c: Chapter): { text: string; spans: Span[] } {
  let text = ''
  const spans: Span[] = []
  for (const s of c.scenes) {
    if (text) text += '\n\n'
    const start = text.length
    text += s.content_text ?? ''
    spans.push({ scene: s, start, end: text.length })
  }
  return { text: text.slice(0, MAX_CHAPTER_CHARS), spans }
}

async function load(db: SupabaseClient, bookId: string, chapterIds: string[] | null) {
  const { data: book } = await db.from('books').select('id, title, style_profile_id').eq('id', bookId).maybeSingle()
  if (!book) throw new HttpError(404, 'Book not found.')
  let q = db
    .from('chapters')
    .select('id, title, position, scenes(id, title, position, content_text, revision)')
    .eq('book_id', bookId)
    .order('position')
  if (chapterIds?.length) q = q.in('id', chapterIds)
  const { data: chapters, error } = await q
  if (error) throw new HttpError(500, 'Could not load the chapters.')
  let style = ''
  if (book.style_profile_id) {
    const { data: wp } = await db.from('writing_profiles').select('summary').eq('id', book.style_profile_id).maybeSingle()
    style = String(wp?.summary ?? '').slice(0, 1500)
  }
  return {
    book: book as { id: string; title: string },
    style,
    chapters: ((chapters ?? []) as Chapter[]).map((c) => ({ ...c, scenes: [...c.scenes].sort((a, b) => a.position - b.position) })),
  }
}

const inputTokens = (type: ReviewType, text: string) =>
  estimateTokens(editorialSystem(type).length + JSON.stringify(EDITORIAL_SCHEMA).length + text.length + 400)
const routeCost = (route: Route | null, input: number) => {
  const m = route && findModel(route.provider, route.model)
  return m ? costUsd(m, input, EST_OUTPUT) : 0
}

export interface FindingDraft {
  chapter_id: string
  scene_id: string | null
  category: string
  severity: 'critical' | 'warning' | 'suggestion'
  description: string
  passage: string
  location: string
  resolution: string
  revision: { scene: Scene; original: string; proposed: string } | null
}

/** Keep only findings whose passage is really in the chapter; attach a revision when it fits one paragraph. */
export function verifyEditorial(
  out: EditorialOutput,
  type: ReviewType,
  chapter: { id: string; title: string; text: string; spans: Span[] },
): { findings: FindingDraft[]; unverified: number } {
  const cats = REVIEW_BRIEFS[type].categories
  const findings: FindingDraft[] = []
  let unverified = 0
  for (const f of Array.isArray(out?.findings) ? out.findings.slice(0, 12) : []) {
    const at = locateExcerpt(chapter.text, String(f.passage ?? ''))
    if (!at) {
      unverified++
      continue
    }
    const span = chapter.spans.find((s) => at.start >= s.start && at.end <= s.end) ?? null
    const passage = chapter.text.slice(at.start, at.end)
    const proposed = String(f.revision ?? '').trim()
    const cat = String(f.category ?? '')
      .toLowerCase()
      .replace(/[^a-z]+/g, '_')
    const fits = span && !passage.includes('\n') && proposed && proposed !== passage
    findings.push({
      chapter_id: chapter.id,
      scene_id: span?.scene.id ?? null,
      category: cats.includes(cat) ? cat : cats[0],
      severity: (['critical', 'warning', 'suggestion'] as const).find((s) => s === f.severity) ?? 'suggestion',
      description: String(f.description ?? '').slice(0, 1500),
      passage,
      location: [chapter.title, span?.scene.title].filter(Boolean).join(', '),
      resolution: String(f.explanation ?? '').slice(0, 1500),
      revision: fits ? { scene: span!.scene, original: passage, proposed: proposed.slice(0, 4000) } : null,
    })
  }
  return { findings, unverified }
}

async function saveFindings(db: SupabaseClient, bookId: string, type: ReviewType, taskId: string, drafts: FindingDraft[]): Promise<number> {
  if (!drafts.length) return 0
  const { data: existing } = await db
    .from('editorial_findings')
    .select('category, original_evidence')
    .eq('book_id', bookId)
    .eq('review_type', type)
    .limit(5000)
  const seen = new Set((existing ?? []).map((e) => `${e.category}|${String(e.original_evidence ?? '').toLowerCase()}`))
  let saved = 0
  for (const d of drafts) {
    const k = `${d.category}|${d.passage.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    const { data: row, error } = await db
      .from('editorial_findings')
      .insert({
        book_id: bookId,
        chapter_id: d.chapter_id,
        scene_id: d.scene_id,
        ai_task_id: taskId,
        review_type: type,
        category: d.category,
        severity: d.severity,
        description: d.description,
        original_evidence: d.passage,
        original_location: d.location,
        suggested_resolution: d.resolution,
      })
      .select('id')
      .single()
    if (error) throw new Error(`save finding: ${error.message}`)
    saved++
    if (d.revision) {
      const { error: pErr } = await db.from('revision_proposals').insert({
        book_id: bookId,
        scene_id: d.revision.scene.id,
        finding_id: row.id,
        ai_task_id: taskId,
        base_revision: d.revision.scene.revision,
        original_text: d.revision.original,
        proposed_text: d.revision.proposed,
        command: `editorial_${type}`,
        insert_mode: 'replace',
        status: 'pending',
      })
      if (pErr) throw new Error(`save revision: ${pErr.message}`)
    }
  }
  return saved
}

export interface EditorialEstimate {
  chapters: number
  words: number
  estimatedCostUsd: number
  route: Route | null
  allowed: boolean
  reason?: string
}

export async function estimateEditorial(
  db: SupabaseClient,
  bookId: string,
  type: ReviewType,
  chapterIds: string[] | null,
): Promise<EditorialEstimate> {
  const [l, settings, spent] = await Promise.all([load(db, bookId, chapterIds), loadSettings(db), spending(db)])
  const route = resolveRoute('editorial_review', settings.routing, availableProviders())
  const texts = l.chapters.map((c) => chapterText(c).text).filter((t) => t.trim())
  const cost = texts.reduce((n, t) => n + routeCost(route, inputTokens(type, t)), 0)
  const words = texts.reduce((n, t) => n + t.split(/\s+/).filter(Boolean).length, 0)
  let allowed = true
  let reason: string | undefined
  if (!texts.length) {
    allowed = false
    reason = 'There is no text to review in the chosen chapters.'
  } else if (!route) {
    allowed = false
    reason = 'AI is not set up on the server yet. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the Netlify environment variables.'
  } else {
    const b = checkBudget(settings, spent, 0, cost)
    if (!b.ok) {
      allowed = false
      reason = b.reason?.replace(/^Paused: this/, 'This')
    }
  }
  return { chapters: texts.length, words, estimatedCostUsd: cost, route, allowed, reason }
}

interface State {
  review_type: ReviewType
  chapter_ids: string[] | null
  chapters_total: number
  done: string[]
  findings: number
  unverified_dropped: number
  declined: number
  model?: string
}

export async function runEditorial(
  db: SupabaseClient,
  bookId: string,
  type: ReviewType,
  action: 'start' | 'resume',
  chapterIds: string[] | null,
  ctx: { continueLater?: () => Promise<void>; now?: () => number } = {},
): Promise<{ status: string }> {
  const now = ctx.now ?? Date.now
  const startedAt = now()
  const key = editorialKey(bookId, type)
  let { data: task } = await db.from('ai_tasks').select('*').eq('idempotency_key', key).maybeSingle()
  if (!task) {
    const ins = await db
      .from('ai_tasks')
      .insert({ task_type: 'editorial_review', idempotency_key: key, book_id: bookId, status: 'queued' })
      .select('*')
      .single()
    task = ins.error ? (await db.from('ai_tasks').select('*').eq('idempotency_key', key).single()).data : ins.data
  }
  if (!task) throw new HttpError(500, 'Could not create the review job.')
  if (task.locked_at && now() - new Date(task.locked_at).getTime() < STALE_LOCK_MS) return { status: 'already_running' }
  const claimQ = db
    .from('ai_tasks')
    .update({ locked_at: new Date(now()).toISOString() })
    .eq('id', task.id)
  const claim = await (task.locked_at ? claimQ.eq('locked_at', task.locked_at) : claimQ.is('locked_at', null)).select('id')
  if (!claim.data?.length) return { status: 'already_running' }
  const release = (patch: Record<string, unknown>) =>
    db
      .from('ai_tasks')
      .update({ ...patch, locked_at: null })
      .eq('id', task!.id)

  try {
    const fresh = action === 'start' || !task.output
    const prev = (fresh ? {} : task.output) as Partial<State>
    const ids = fresh ? (chapterIds?.length ? chapterIds : null) : (prev.chapter_ids ?? null)
    const l = await load(db, bookId, ids)
    const settings = await loadSettings(db)
    const route = resolveRoute('editorial_review', settings.routing, availableProviders())
    const out: State = {
      review_type: type,
      chapter_ids: ids,
      chapters_total: l.chapters.length,
      done: prev.done ?? [],
      findings: prev.findings ?? 0,
      unverified_dropped: prev.unverified_dropped ?? 0,
      declined: prev.declined ?? 0,
      model: route?.model,
    }
    let spentTask = fresh ? 0 : Number(task.actual_cost_usd ?? 0)
    await db
      .from('ai_tasks')
      .update({
        task_type: 'editorial_review',
        status: 'running',
        error: null,
        input: { review_type: type, chapter_ids: ids },
        output: out,
        total_steps: l.chapters.length,
        completed_steps: out.done.length,
        actual_cost_usd: spentTask,
        attempts: (task.attempts ?? 0) + 1,
        started_at: new Date(now()).toISOString(),
        completed_at: null,
      })
      .eq('id', task.id)

    const todo = l.chapters.filter((c) => !out.done.includes(c.id)).map((c) => ({ c, ...chapterText(c) }))
    for (const t of todo) if (!t.text.trim()) out.done.push(t.c.id)
    const aiTodo = todo.filter((t) => t.text.trim())
    if (aiTodo.length && !route) {
      await release({
        status: 'failed',
        output: out,
        error: 'AI is not set up on the server yet. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the Netlify environment variables.',
      })
      return { status: 'failed' }
    }
    const pre = checkBudget(
      settings,
      await spending(db),
      spentTask,
      aiTodo.reduce((n, t) => n + routeCost(route, inputTokens(type, t.text)), 0),
    )
    if (aiTodo.length && !pre.ok) {
      await release({ status: 'paused', output: out, error: pre.reason })
      return { status: 'paused' }
    }

    let stop: 'time' | 'paused' | 'cancelled' | 'fatal' | null = null
    let stopMessage = ''
    for (let i = 0; i < aiTodo.length && !stop; i += CONCURRENCY) {
      if (now() - startedAt > RUN_BUDGET_MS) {
        stop = 'time'
        break
      }
      const { data: live } = await db.from('ai_tasks').select('status').eq('id', task.id).single()
      if (live?.status === 'cancelled') {
        stop = 'cancelled'
        break
      }
      const batch = aiTodo.slice(i, i + CONCURRENCY)
      const b = checkBudget(
        settings,
        await spending(db),
        spentTask,
        batch.reduce((n, t) => n + routeCost(route, inputTokens(type, t.text)), 0),
      )
      if (!b.ok) {
        stop = 'paused'
        stopMessage = b.reason!
        break
      }
      const results = await Promise.all(
        batch.map(async (t) => {
          try {
            const r = await runStructured<EditorialOutput>(db, {
              route: route!,
              taskType: 'editorial_review',
              taskId: task!.id,
              request: {
                system: editorialSystem(type),
                input: editorialInput(l.book.title, t.c.title, t.text, l.style),
                schema: EDITORIAL_SCHEMA as unknown as Record<string, unknown>,
                schemaName: 'editorial_findings',
                maxOutputTokens: 6000,
              },
            })
            const v = verifyEditorial(r.data, type, { id: t.c.id, title: t.c.title, text: t.text, spans: t.spans })
            const saved = await saveFindings(db, bookId, type, task!.id, v.findings)
            return { id: t.c.id, cost: r.cost, saved, unverified: v.unverified, declined: false }
          } catch (err) {
            const cost = (err as { cost?: number }).cost ?? 0
            if (err instanceof ProviderDeclined) return { id: t.c.id, cost, saved: 0, unverified: 0, declined: true }
            console.error('editorial chapter failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
            return {
              id: null,
              cost,
              saved: 0,
              unverified: 0,
              declined: false,
              fatal: err instanceof ProviderError && !err.retryable,
              message: err instanceof ProviderError ? err.message : 'A chapter could not be reviewed.',
            }
          }
        }),
      )
      for (const r of results) {
        spentTask += r.cost
        if (r.id) out.done.push(r.id)
        out.findings += r.saved
        out.unverified_dropped += r.unverified
        if (r.declined) out.declined++
        if ('fatal' in r && r.fatal) {
          stop = 'fatal'
          stopMessage = r.message ?? ''
        }
      }
      await db
        .from('ai_tasks')
        .update({
          output: out,
          completed_steps: out.done.length,
          actual_cost_usd: Number(spentTask.toFixed(6)),
          locked_at: new Date(now()).toISOString(),
        })
        .eq('id', task.id)
    }

    const base = { output: out, actual_cost_usd: Number(spentTask.toFixed(6)) }
    if (stop === 'time') {
      await release(base)
      if (ctx.continueLater) await ctx.continueLater()
      return { status: 'continuing' }
    }
    if (stop === 'cancelled') {
      await release({ ...base, error: 'Stopped. Resume to review the remaining chapters.' })
      return { status: 'cancelled' }
    }
    if (stop === 'paused') {
      await release({ ...base, status: 'paused', error: stopMessage })
      return { status: 'paused' }
    }
    const left = l.chapters.filter((c) => !out.done.includes(c.id)).length
    if (stop === 'fatal' || left) {
      await release({
        ...base,
        status: 'failed',
        error: stop === 'fatal' ? stopMessage : `${left} ${left === 1 ? 'chapter' : 'chapters'} could not be reviewed. Resume to try again.`,
      })
      return { status: 'failed' }
    }
    await release({
      ...base,
      status: 'completed',
      completed_steps: l.chapters.length,
      completed_at: new Date(now()).toISOString(),
      error: out.declined
        ? `${out.declined} ${out.declined === 1 ? 'chapter was' : 'chapters were'} declined by the AI provider and not reviewed.`
        : null,
    })
    return { status: 'completed' }
  } catch (err) {
    console.error('editorial failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
    await release({ status: 'failed', error: err instanceof HttpError ? err.message : 'The review stopped unexpectedly. Resume to continue.' })
    return { status: 'failed' }
  }
}
