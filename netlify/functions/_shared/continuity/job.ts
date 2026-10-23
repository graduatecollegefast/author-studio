// Continuity check for one book: a free canon-vs-canon pass, then each chapter of the
// current manuscript (the editable chapters, not the uploaded file) against the approved
// canon of every book in the same series or universe. Resumable chapter by chapter.
// Findings are only ever suggestions: nothing here edits canon or manuscript text.
import type { SupabaseClient } from '@supabase/supabase-js'
import { costUsd, estimateTokens, findModel, resolveRoute, type Route } from '../../../../src/lib/ai/catalog'
import { HttpError } from '../http'
import { availableProviders, checkBudget, loadSettings, ProviderDeclined, ProviderError, runStructured, spending } from '../ai'
import { locateExcerpt } from '../analysis/evidence'
import { relatedBooks } from '../context/related'
import { canonConflicts, chapterContext, type CanonFactRow, type CharacterRow, type ContextFact, type FindingDraft } from './canon'
import { CONTINUITY_CATEGORIES, CONTINUITY_SCHEMA, CONTINUITY_SYSTEM, continuityInput, type ContinuityOutput } from './prompts'

const STALE_LOCK_MS = 5 * 60 * 1000
const RUN_BUDGET_MS = 11 * 60 * 1000
const CONCURRENCY = 3
const MAX_CHAPTER_CHARS = 120_000
const EST_OUTPUT = 900

export const continuityKey = (bookId: string) => `continuity:${bookId}`

interface Chapter {
  id: string
  title: string
  position: number
  scenes: Array<{ id: string; title: string; position: number; content_text: string }>
}

interface Loaded {
  book: { id: string; title: string }
  relatedBookIds: string[]
  titles: Map<string, string>
  facts: CanonFactRow[]
  characters: CharacterRow[]
  chapters: Chapter[]
}

async function load(db: SupabaseClient, bookId: string): Promise<Loaded> {
  const { data: book } = await db.from('books').select('id, title').eq('id', bookId).maybeSingle()
  if (!book) throw new HttpError(404, 'Book not found.')
  const relatedBookIds = await relatedBooks(db, bookId)
  const [{ data: books }, { data: chars }, { data: chapters, error: chErr }] = await Promise.all([
    db.from('books').select('id, title').in('id', relatedBookIds),
    db.from('characters').select('id, full_name, preferred_name, aliases, nicknames').limit(5000),
    db.from('chapters').select('id, title, position, scenes(id, title, position, content_text)').eq('book_id', bookId).order('position'),
  ])
  if (chErr) throw new HttpError(500, 'Could not load the chapters.')
  const facts: CanonFactRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from('canon_facts')
      .select(
        'id, book_id, entity_type, entity_id, entity_label, attribute, value, statement_type, payload, fact_sources(excerpt, location_label, book_id)',
      )
      .in('book_id', relatedBookIds)
      .eq('status', 'approved')
      .in('entity_type', ['character', 'relationship', 'world_element', 'story_event'])
      .order('created_at')
      .range(from, from + 999)
    facts.push(...((data ?? []) as unknown as CanonFactRow[]))
    if (!data || data.length < 1000 || facts.length >= 10000) break
  }
  const sorted = ((chapters ?? []) as Chapter[]).map((c) => ({ ...c, scenes: [...c.scenes].sort((a, b) => a.position - b.position) }))
  return {
    book: book as { id: string; title: string },
    relatedBookIds,
    titles: new Map((books ?? []).map((b) => [b.id as string, b.title as string])),
    facts,
    characters: (chars ?? []) as CharacterRow[],
    chapters: sorted,
  }
}

function chapterText(c: Chapter): { text: string; spans: Array<{ sceneId: string; title: string; start: number; end: number }> } {
  let text = ''
  const spans: Array<{ sceneId: string; title: string; start: number; end: number }> = []
  for (const s of c.scenes) {
    if (text) text += '\n\n'
    const start = text.length
    text += s.content_text ?? ''
    spans.push({ sceneId: s.id, title: s.title, start, end: text.length })
  }
  return { text: text.slice(0, MAX_CHAPTER_CHARS), spans }
}

const inputTokens = (text: string, ctx: ContextFact[]) =>
  estimateTokens(
    CONTINUITY_SYSTEM.length + JSON.stringify(CONTINUITY_SCHEMA).length + text.length + ctx.reduce((n, c) => n + c.line.length + 1, 0) + 200,
  )

function routeCost(route: Route | null, input: number, output: number) {
  const m = route && findModel(route.provider, route.model)
  return m ? costUsd(m, input, output) : 0
}

/** Turn model output into findings, keeping only those quoting the chapter exactly and citing real canon. */
export function verifyFindings(
  out: ContinuityOutput,
  ctx: ContextFact[],
  chapter: { id: string; title: string; text: string; spans: Array<{ sceneId: string; title: string; start: number; end: number }> },
  titles: Map<string, string>,
): { findings: Array<FindingDraft & { chapter_id: string; scene_id: string | null }>; unverified: number } {
  const byRef = new Map(ctx.map((c) => [c.ref, c.fact]))
  const findings: Array<FindingDraft & { chapter_id: string; scene_id: string | null }> = []
  let unverified = 0
  for (const f of Array.isArray(out?.findings) ? out.findings.slice(0, 20) : []) {
    const refs = (Array.isArray(f.canon_refs) ? f.canon_refs : []).map((r) =>
      String(r)
        .replace(/[[\]\s]/g, '')
        .toUpperCase(),
    )
    const cited = refs.map((r) => byRef.get(r)).filter((x): x is CanonFactRow => Boolean(x))
    const at = locateExcerpt(chapter.text, String(f.conflicting_excerpt ?? ''))
    if (!cited.length || !at) {
      unverified++
      continue
    }
    const span = chapter.spans.find((s) => at.start >= s.start && at.start < s.end) ?? null
    const first = cited[0]
    const where = [first.book_id ? titles.get(first.book_id) : null, first.fact_sources[0]?.location_label].filter(Boolean).join(', ')
    findings.push({
      category: (CONTINUITY_CATEGORIES as readonly string[]).includes(f.category) ? f.category : 'contradictory_scene',
      severity: (['critical', 'warning', 'suggestion'] as const).find((s) => s === f.severity) ?? 'suggestion',
      description: String(f.description ?? '').slice(0, 1000),
      original_evidence: cited
        .map((c) => {
          const q = c.fact_sources.find((s) => s.excerpt)?.excerpt
          return `${c.entity_label ?? ''} ${c.attribute.replace(/_/g, ' ')}: ${c.value}${q ? ` ("${q}")` : ''}`.trim()
        })
        .join('\n')
        .slice(0, 3000),
      original_location: where || 'Story Bible',
      conflicting_evidence: chapter.text.slice(at.start, at.end),
      conflicting_location: [chapter.title, span?.title].filter(Boolean).join(', '),
      suggested_resolution: String(f.suggested_resolution ?? '').slice(0, 1000),
      canon_fact_ids: cited.map((c) => c.id),
      chapter_id: chapter.id,
      scene_id: span?.sceneId ?? null,
    })
  }
  return { findings, unverified }
}

export interface ContinuityEstimate {
  bookTitle: string
  relatedBooks: number
  canonFacts: number
  chaptersTotal: number
  chaptersToCheck: number
  chaptersWithoutCanon: number
  estimatedCostUsd: number
  route: Route | null
  spent: { today: number; month: number }
  allowed: boolean
  reason?: string
}

export async function estimateContinuity(db: SupabaseClient, bookId: string): Promise<ContinuityEstimate> {
  const [l, settings, spent] = await Promise.all([load(db, bookId), loadSettings(db), spending(db)])
  const route = resolveRoute('continuity_check', settings.routing, availableProviders())
  let cost = 0
  let toCheck = 0
  for (const c of l.chapters) {
    const { text } = chapterText(c)
    if (!text.trim()) continue
    const ctx = chapterContext(text, l.facts, l.characters, l.titles, bookId)
    if (!ctx.length) continue
    toCheck++
    cost += routeCost(route, inputTokens(text, ctx), EST_OUTPUT)
  }
  let allowed = true
  let reason: string | undefined
  if (!l.chapters.length) {
    allowed = false
    reason = 'This book has no chapters yet. Import a manuscript or write a chapter first.'
  } else if (!l.facts.length) {
    reason = 'No approved canon yet, so only the free checks can run. Approve discoveries from AI analysis to compare chapters against canon.'
  } else if (toCheck && !route) {
    allowed = false
    reason = 'AI is not set up on the server yet. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the Netlify environment variables.'
  } else {
    const b = checkBudget(settings, spent, 0, cost)
    if (!b.ok) {
      allowed = false
      reason = b.reason?.replace(/^Paused: this/, 'This')
    }
  }
  return {
    bookTitle: l.book.title,
    relatedBooks: l.relatedBookIds.length,
    canonFacts: l.facts.length,
    chaptersTotal: l.chapters.length,
    chaptersToCheck: toCheck,
    chaptersWithoutCanon: l.chapters.length - toCheck,
    estimatedCostUsd: cost,
    route,
    spent,
    allowed,
    reason,
  }
}

export interface ContinuityOutputState {
  chapters_total: number
  done: string[]
  findings: number
  unverified_dropped: number
  declined: number
  canon_checked: boolean
  /** Chapters chosen for this run; null means the whole book. */
  chapter_ids?: string[] | null
  model?: string
}

export async function saveFindings(
  db: SupabaseClient,
  bookId: string,
  taskId: string,
  drafts: Array<FindingDraft & { chapter_id?: string | null; scene_id?: string | null }>,
): Promise<number> {
  if (!drafts.length) return 0
  // Never repeat a finding the author has already seen, whatever they decided about it.
  const { data: existing } = await db
    .from('editorial_findings')
    .select('category, description, conflicting_evidence')
    .eq('book_id', bookId)
    .eq('review_type', 'continuity')
    .limit(5000)
  const seen = new Set(
    (existing ?? []).map((e) => `${e.category}|${(e.conflicting_evidence ?? '').toLowerCase()}|${e.conflicting_evidence ? '' : e.description}`),
  )
  const rows = drafts
    .filter((d) => {
      const k = `${d.category}|${d.conflicting_evidence.toLowerCase()}|${d.conflicting_evidence ? '' : d.description}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map((d) => ({
      book_id: bookId,
      chapter_id: d.chapter_id ?? null,
      scene_id: d.scene_id ?? null,
      ai_task_id: taskId,
      review_type: 'continuity',
      category: d.category,
      severity: d.severity,
      description: d.description,
      original_evidence: d.original_evidence,
      original_location: d.original_location,
      conflicting_evidence: d.conflicting_evidence,
      conflicting_location: d.conflicting_location,
      suggested_resolution: d.suggested_resolution,
      canon_fact_ids: d.canon_fact_ids,
    }))
  if (!rows.length) return 0
  const { error } = await db.from('editorial_findings').insert(rows)
  if (error) throw new Error(`save findings: ${error.message}`)
  return rows.length
}

export async function runContinuity(
  db: SupabaseClient,
  bookId: string,
  action: 'start' | 'resume' | 'restart',
  ctx: { continueLater?: () => Promise<void>; now?: () => number; chapterIds?: string[] | null } = {},
): Promise<{ status: string }> {
  const now = ctx.now ?? Date.now
  const startedAt = now()
  const key = continuityKey(bookId)
  let { data: task } = await db.from('ai_tasks').select('*').eq('idempotency_key', key).maybeSingle()
  if (!task) {
    const ins = await db
      .from('ai_tasks')
      .insert({ task_type: 'continuity_check', idempotency_key: key, book_id: bookId, status: 'queued' })
      .select('*')
      .single()
    task = ins.error ? (await db.from('ai_tasks').select('*').eq('idempotency_key', key).single()).data : ins.data
  }
  if (!task) throw new HttpError(500, 'Could not create the continuity job.')
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
    const fresh = action === 'restart' || (action === 'start' && Boolean(ctx.chapterIds?.length)) || !task.output || task.status === 'completed'
    const chapterIds = fresh
      ? ctx.chapterIds?.length
        ? ctx.chapterIds
        : null
      : ((task.output as Partial<ContinuityOutputState>).chapter_ids ?? null)
    const l = await load(db, bookId)
    if (chapterIds) l.chapters = l.chapters.filter((c) => chapterIds.includes(c.id))
    const settings = await loadSettings(db)
    const route = resolveRoute('continuity_check', settings.routing, availableProviders())
    if (action === 'restart') {
      await db.from('editorial_findings').delete().eq('book_id', bookId).eq('review_type', 'continuity').eq('status', 'open').eq('ai_task_id', task.id)
    }
    const prev = (fresh ? {} : task.output) as Partial<ContinuityOutputState>
    const out: ContinuityOutputState = {
      chapters_total: l.chapters.length,
      done: prev.done ?? [],
      findings: prev.findings ?? 0,
      unverified_dropped: prev.unverified_dropped ?? 0,
      declined: prev.declined ?? 0,
      canon_checked: prev.canon_checked ?? false,
      chapter_ids: chapterIds,
      model: route?.model,
    }
    let spentTask = fresh ? 0 : Number(task.actual_cost_usd ?? 0)
    await db
      .from('ai_tasks')
      .update({
        status: 'running',
        error: null,
        output: out,
        total_steps: l.chapters.length + 1,
        completed_steps: out.done.length + (out.canon_checked ? 1 : 0),
        actual_cost_usd: spentTask,
        attempts: (task.attempts ?? 0) + 1,
        started_at: new Date(now()).toISOString(),
        completed_at: null,
      })
      .eq('id', task.id)

    // 1. Free: canon that contradicts itself.
    if (!out.canon_checked) {
      out.findings += await saveFindings(db, bookId, task.id, canonConflicts(l.facts, new Set([bookId]), l.titles))
      out.canon_checked = true
    }

    // 2. AI: each chapter against the canon it mentions.
    const todo = l.chapters
      .filter((c) => !out.done.includes(c.id))
      .map((c) => {
        const t = chapterText(c)
        return { c, ...t, ctx: t.text.trim() ? chapterContext(t.text, l.facts, l.characters, l.titles, bookId) : [] }
      })
    for (const t of todo) if (!t.ctx.length) out.done.push(t.c.id) // nothing to compare against: free skip
    const aiTodo = todo.filter((t) => t.ctx.length)
    if (aiTodo.length && !route) {
      await release({
        status: 'failed',
        output: out,
        error: 'AI is not set up on the server yet. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the Netlify environment variables.',
      })
      return { status: 'failed' }
    }
    const remaining = aiTodo.reduce((n, t) => n + routeCost(route, inputTokens(t.text, t.ctx), EST_OUTPUT), 0)
    const pre = checkBudget(settings, await spending(db), spentTask, remaining)
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
      const est = batch.reduce((n, t) => n + routeCost(route, inputTokens(t.text, t.ctx), EST_OUTPUT), 0)
      const b = checkBudget(settings, await spending(db), spentTask, est)
      if (!b.ok) {
        stop = 'paused'
        stopMessage = b.reason!
        break
      }
      const results = await Promise.all(
        batch.map(async (t) => {
          try {
            const r = await runStructured<ContinuityOutput>(db, {
              route: route!,
              taskType: 'continuity_check',
              taskId: task!.id,
              request: {
                system: CONTINUITY_SYSTEM,
                input: continuityInput(
                  l.book.title,
                  t.c.title,
                  t.text,
                  t.ctx.map((x) => x.line),
                ),
                schema: CONTINUITY_SCHEMA as unknown as Record<string, unknown>,
                schemaName: 'continuity_findings',
                maxOutputTokens: 4000,
              },
            })
            const v = verifyFindings(r.data, t.ctx, { id: t.c.id, title: t.c.title, text: t.text, spans: t.spans }, l.titles)
            const saved = await saveFindings(db, bookId, task!.id, v.findings)
            return { id: t.c.id, cost: r.cost, saved, unverified: v.unverified, declined: false }
          } catch (err) {
            const cost = (err as { cost?: number }).cost ?? 0
            if (err instanceof ProviderDeclined) return { id: t.c.id, cost, saved: 0, unverified: 0, declined: true }
            console.error('continuity chapter failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
            return {
              id: null,
              cost,
              saved: 0,
              unverified: 0,
              declined: false,
              fatal: err instanceof ProviderError && !err.retryable,
              message: err instanceof ProviderError ? err.message : 'A chapter could not be checked.',
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
          completed_steps: out.done.length + 1,
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
      await release({ ...base, error: 'Stopped. Resume to check the remaining chapters.' })
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
        error: stop === 'fatal' ? stopMessage : `${left} ${left === 1 ? 'chapter' : 'chapters'} could not be checked. Resume to try again.`,
      })
      return { status: 'failed' }
    }
    await release({
      ...base,
      status: 'completed',
      completed_steps: l.chapters.length + 1,
      completed_at: new Date(now()).toISOString(),
      error: out.declined
        ? `${out.declined} ${out.declined === 1 ? 'chapter was' : 'chapters were'} declined by the AI provider and not checked.`
        : null,
    })
    return { status: 'completed' }
  } catch (err) {
    console.error('continuity failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
    await release({ status: 'failed', error: 'The continuity check stopped unexpectedly. Resume to continue.' })
    return { status: 'failed' }
  }
}
