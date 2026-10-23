// Series review: compare the book being written with the earlier books of its series.
// 1. Free scan: which characters from earlier books appear in this book, which are not
//    linked to it yet, and which character records look like duplicates.
// 2. AI review (resumable): each shared character, with their profile, approved canon and
//    passages from the earlier books, against the passages that mention them now; then
//    each chapter against the earlier passages that share its names and places.
// Findings are continuity findings: they show here, in the Continuity Checker and in the
// Editorial Studio. Nothing here edits text, canon or character profiles.
import type { SupabaseClient } from '@supabase/supabase-js'
import { costUsd, estimateTokens, findModel, resolveRoute, type Route } from '../../../../src/lib/ai/catalog'
import { HttpError } from '../http'
import { availableProviders, checkBudget, loadSettings, ProviderDeclined, ProviderError, runStructured, spending } from '../ai'
import { locateExcerpt } from '../analysis/evidence'
import type { FindingDraft } from '../continuity/canon'
import { saveFindings } from '../continuity/job'
import { CONTINUITY_CATEGORIES } from '../continuity/prompts'
import { CHAPTER_SYSTEM, CHARACTER_SYSTEM, safe, SERIES_SCHEMA, type SeriesOutput } from './prompts'
import {
  ambiguousFirstNames,
  clip,
  countMatches,
  nameMatcher,
  nameVariants,
  paragraphs,
  relevantParagraphs,
  spread,
  where,
  type Loc,
  type Para,
} from './text'

const STALE_LOCK_MS = 5 * 60 * 1000
const RUN_BUDGET_MS = 11 * 60 * 1000
const CONCURRENCY = 3
const EST_OUTPUT = 1500
const MAX_CHAPTER_CHARS = 80_000
const MAX_SHARED = 60

export const seriesKey = (bookId: string) => `series_review:${bookId}`

interface SceneRow {
  id: string
  title: string
  position: number
  content_text: string
}
interface ChapterRow {
  id: string
  title: string
  position: number
  book_id: string
  scenes: SceneRow[]
}
interface CharacterRow {
  id: string
  full_name: string
  preferred_name: string | null
  aliases: string[] | null
  nicknames: string[] | null
  pronouns: string | null
  age: string | null
  date_of_birth: string | null
  occupation: string | null
  role: string | null
  appearance: Record<string, unknown> | null
  personality: Record<string, unknown> | null
  history: Record<string, unknown> | null
  custom_fields: Record<string, unknown> | null
  first_appearance_book_id: string | null
}
interface FactRow {
  id: string
  book_id: string | null
  entity_id: string | null
  attribute: string
  value: string
  fact_sources: Array<{ excerpt: string | null; location_label: string | null }>
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

interface Loaded {
  book: { id: string; title: string }
  series: Array<{ id: string; name: string; order: number | null }>
  earlier: EarlierBook[]
  chapters: ChapterRow[]
  curParas: Para[]
  prevParas: Para[]
  chars: CharacterRow[]
  facts: FactRow[]
  shared: Array<SharedCharacter & { re: RegExp | null; variants: string[] }>
  duplicates: Array<{ name: string; ids: string[] }>
}

const sortScenes = (c: ChapterRow) => ({ ...c, scenes: [...c.scenes].sort((a, b) => a.position - b.position) })

async function load(db: SupabaseClient, bookId: string): Promise<Loaded> {
  const { data: book } = await db.from('books').select('id, title').eq('id', bookId).maybeSingle()
  if (!book) throw new HttpError(404, 'Book not found.')
  const { data: mine } = await db.from('series_books').select('series_id, reading_order').eq('book_id', bookId)
  const seriesIds = (mine ?? []).map((r) => r.series_id as string)
  const empty: Loaded = { book, series: [], earlier: [], chapters: [], curParas: [], prevParas: [], chars: [], facts: [], shared: [], duplicates: [] }
  if (!seriesIds.length) return empty
  const [{ data: series }, { data: members }] = await Promise.all([
    db.from('series').select('id, name').in('id', seriesIds),
    db
      .from('series_books')
      .select('series_id, book_id, reading_order, books!series_books_book_id_owner_id_fkey(id, title, word_count)')
      .in('series_id', seriesIds),
  ])
  const names = new Map((series ?? []).map((s) => [s.id as string, s.name as string]))
  const myOrder = new Map((mine ?? []).map((r) => [r.series_id as string, r.reading_order as number | null]))
  const earlierMap = new Map<string, EarlierBook>()
  for (const m of (members ?? []) as unknown as Array<{
    series_id: string
    book_id: string
    reading_order: number | null
    books: { id: string; title: string; word_count: number } | null
  }>) {
    if (m.book_id === bookId || !m.books) continue
    const mineAt = myOrder.get(m.series_id)
    // Earlier = before this book in reading order. Without an order, every other book counts.
    const earlier = mineAt == null || m.reading_order == null || m.reading_order < mineAt
    if (earlier && !earlierMap.has(m.book_id))
      earlierMap.set(m.book_id, {
        id: m.book_id,
        title: m.books.title,
        order: m.reading_order,
        series: names.get(m.series_id) ?? '',
        approvedFacts: 0,
        pendingFacts: 0,
        words: m.books.word_count ?? 0,
      })
  }
  const earlier = [...earlierMap.values()].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.title.localeCompare(b.title))
  const base = { ...empty, series: seriesIds.map((id) => ({ id, name: names.get(id) ?? '', order: myOrder.get(id) ?? null })), earlier }
  if (!earlier.length) return base
  const prevIds = earlier.map((b) => b.id)

  const [{ data: chapters, error }, { data: chars }, { data: apps }] = await Promise.all([
    db
      .from('chapters')
      .select('id, title, position, book_id, scenes(id, title, position, content_text)')
      .in('book_id', [bookId, ...prevIds])
      .order('position'),
    db
      .from('characters')
      .select(
        'id, full_name, preferred_name, aliases, nicknames, pronouns, age, date_of_birth, occupation, role, appearance, personality, history, custom_fields, first_appearance_book_id',
      )
      .order('full_name')
      .limit(5000),
    db
      .from('character_appearances')
      .select('character_id, book_id')
      .in('book_id', [bookId, ...prevIds])
      .limit(20000),
  ])
  if (error) throw new HttpError(500, 'Could not load the chapters.')
  const facts: FactRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from('canon_facts')
      .select('id, book_id, entity_id, attribute, value, fact_sources(excerpt, location_label)')
      .in('book_id', prevIds)
      .eq('status', 'approved')
      .eq('entity_type', 'character')
      .order('id')
      .range(from, from + 999)
    facts.push(...((data ?? []) as FactRow[]))
    if (!data || data.length < 1000 || facts.length >= 10000) break
  }
  await Promise.all(
    earlier.map(async (b) => {
      const [{ count: a }, { count: p }] = await Promise.all([
        db.from('canon_facts').select('id', { count: 'exact', head: true }).eq('book_id', b.id).eq('status', 'approved'),
        db.from('canon_facts').select('id', { count: 'exact', head: true }).eq('book_id', b.id).eq('status', 'proposed'),
      ])
      b.approvedFacts = a ?? 0
      b.pendingFacts = p ?? 0
    }),
  )

  const titleOf = new Map<string, string>([[bookId, book.title], ...earlier.map((b) => [b.id, b.title] as [string, string])])
  const order = new Map(earlier.map((b, i) => [b.id, i]))
  const all = ((chapters ?? []) as ChapterRow[]).map(sortScenes)
  const paras = (c: ChapterRow) =>
    c.scenes.flatMap((s) =>
      paragraphs(s.content_text ?? '', {
        bookId: c.book_id,
        bookTitle: titleOf.get(c.book_id) ?? '',
        chapterId: c.id,
        chapterTitle: c.title,
        sceneId: s.id,
        sceneTitle: s.title,
      }),
    )
  const mine2 = all.filter((c) => c.book_id === bookId)
  const prev = all
    .filter((c) => c.book_id !== bookId)
    .sort((a, b) => (order.get(a.book_id) ?? 0) - (order.get(b.book_id) ?? 0) || a.position - b.position)
  const curParas = mine2.flatMap(paras)
  const prevParas = prev.flatMap(paras)

  const characters = (chars ?? []) as CharacterRow[]
  const ambiguous = ambiguousFirstNames(characters)
  const linkedPrev = new Map<string, Set<string>>()
  const linkedHere = new Set<string>()
  for (const a of apps ?? []) {
    if (a.book_id === bookId) linkedHere.add(a.character_id as string)
    else linkedPrev.set(a.character_id as string, (linkedPrev.get(a.character_id as string) ?? new Set()).add(a.book_id as string))
  }
  for (const c of characters)
    if (c.first_appearance_book_id && order.has(c.first_appearance_book_id))
      linkedPrev.set(c.id, (linkedPrev.get(c.id) ?? new Set()).add(c.first_appearance_book_id))
  for (const f of facts) if (f.entity_id && f.book_id) linkedPrev.set(f.entity_id, (linkedPrev.get(f.entity_id) ?? new Set()).add(f.book_id))

  const curText = curParas.map((p) => p.text).join('\n')
  const shared: Loaded['shared'] = []
  for (const c of characters) {
    const variants = nameVariants(c, ambiguous)
    const re = nameMatcher(variants)
    const prevBooks = new Set(linkedPrev.get(c.id) ?? [])
    let earlierMentions = 0
    for (const p of prevParas) {
      const n = countMatches(p.text, re)
      if (n) {
        earlierMentions += n
        prevBooks.add(p.bookId)
      }
    }
    if (!prevBooks.size) continue
    const mentions = countMatches(curText, re)
    if (!mentions && !linkedHere.has(c.id)) continue
    shared.push({
      id: c.id,
      name: c.full_name,
      earlierBooks: earlier.filter((b) => prevBooks.has(b.id)).map((b) => b.title),
      mentions,
      earlierMentions,
      linked: linkedHere.has(c.id),
      facts: facts.filter((f) => f.entity_id === c.id).length,
      re,
      variants,
    })
  }
  shared.sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name))

  const byName = new Map<string, string[]>()
  for (const c of characters) {
    const k = c.full_name.trim().toLowerCase().replace(/\s+/g, ' ')
    byName.set(k, [...(byName.get(k) ?? []), c.id])
  }
  const duplicates = [...byName.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([, ids]) => ({ name: characters.find((c) => c.id === ids[0])!.full_name, ids }))

  return { ...base, chapters: mine2, curParas, prevParas, chars: characters, facts, shared: shared.slice(0, MAX_SHARED), duplicates }
}

// ---------------------------------------------------------------------------
// Prompt inputs
// ---------------------------------------------------------------------------
interface CharacterStep {
  kind: 'character'
  key: string
  name: string
  input: string
  earlier: Para[]
  current: Para[]
  facts: FactRow[]
}
interface ChapterStep {
  kind: 'chapter'
  key: string
  name: string
  input: string
  earlier: Para[]
  chapter: { id: string; title: string; text: string; spans: Array<{ loc: Loc; start: number; end: number }> }
}
type Step = CharacterStep | ChapterStep

const flat = (v: Record<string, unknown> | null) =>
  Object.entries(v ?? {})
    .filter(([, x]) => x !== null && x !== '' && !(Array.isArray(x) && !x.length))
    .map(([k, x]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(x) ? x.join(', ') : typeof x === 'object' ? JSON.stringify(x) : String(x)}`)

function characterStep(l: Loaded, s: Loaded['shared'][number]): CharacterStep {
  const c = l.chars.find((x) => x.id === s.id)!
  const earlier = spread(
    l.prevParas.filter((p) => countMatches(p.text, s.re) > 0),
    10,
  ).map((p) => ({ ...p, text: clip(p.text, s.re) }))
  const current = spread(
    l.curParas.filter((p) => countMatches(p.text, s.re) > 0),
    14,
  ).map((p) => ({ ...p, text: clip(p.text, s.re) }))
  const facts = l.facts.filter((f) => f.entity_id === s.id).slice(0, 60)
  const titleOf = new Map(l.earlier.map((b) => [b.id, b.title]))
  const profile = [
    `Name: ${c.full_name}`,
    s.variants.length > 1 ? `Also called: ${s.variants.filter((v) => v !== c.full_name).join(', ')}` : '',
    ...(['pronouns', 'age', 'date_of_birth', 'occupation', 'role'] as const).map((k) => (c[k] ? `${k.replace(/_/g, ' ')}: ${c[k]}` : '')),
    ...flat(c.appearance),
    ...flat(c.personality),
    ...flat(c.history),
    ...flat(c.custom_fields),
  ].filter(Boolean)
  const input = [
    `Book being written: ${l.book.title}`,
    `Earlier books: ${l.earlier.map((b) => b.title).join(', ')}`,
    `Character: ${c.full_name}`,
    '',
    '<profile>',
    safe(profile.join('\n')),
    '</profile>',
    '',
    '<canon>',
    ...facts.map((f, i) => {
      const q = f.fact_sources.find((x) => x.excerpt)?.excerpt
      return safe(
        `[F${i + 1}] ${f.attribute.replace(/_/g, ' ')}: ${f.value}${q ? ` ("${q}")` : ''} (${[f.book_id ? titleOf.get(f.book_id) : null, f.fact_sources[0]?.location_label].filter(Boolean).join(', ')})`,
      )
    }),
    '</canon>',
    '',
    '<earlier>',
    ...earlier.map((p, i) => `[P${i + 1}] (${where(p)}) ${safe(p.text)}`),
    '</earlier>',
    '',
    '<current>',
    ...current.map((p, i) => `[C${i + 1}] (${where(p, false)}) ${safe(p.text)}`),
    '</current>',
  ].join('\n')
  return { kind: 'character', key: `char:${s.id}`, name: c.full_name, input, earlier, current, facts }
}

function chapterStep(l: Loaded, c: ChapterRow, names: string[]): ChapterStep {
  let text = ''
  const spans: ChapterStep['chapter']['spans'] = []
  for (const s of c.scenes) {
    if (text) text += '\n\n'
    const start = text.length
    text += s.content_text ?? ''
    spans.push({
      loc: { bookId: l.book.id, bookTitle: l.book.title, chapterId: c.id, chapterTitle: c.title, sceneId: s.id, sceneTitle: s.title },
      start,
      end: text.length,
    })
  }
  text = text.slice(0, MAX_CHAPTER_CHARS)
  const earlier = relevantParagraphs(text, l.prevParas, names).map((p) => ({ ...p, text: clip(p.text, null) }))
  const input = [
    `Book being written: ${l.book.title}`,
    `Earlier books: ${l.earlier.map((b) => b.title).join(', ')}`,
    '',
    '<earlier>',
    ...earlier.map((p, i) => `[P${i + 1}] (${where(p)}) ${safe(p.text)}`),
    '</earlier>',
    '',
    `<chapter title="${safe(c.title).replace(/"/g, "'")}">`,
    safe(text),
    '</chapter>',
  ].join('\n')
  return { kind: 'chapter', key: `chap:${c.id}`, name: c.title, input, earlier, chapter: { id: c.id, title: c.title, text, spans } }
}

function buildSteps(l: Loaded, characterIds: string[] | null, includeChapters: boolean): Step[] {
  const chosen = l.shared.filter((s) => (characterIds ? characterIds.includes(s.id) : true) && s.mentions > 0)
  const steps: Step[] = chosen.map((s) => characterStep(l, s))
  if (includeChapters) {
    const names = l.shared.flatMap((s) => s.variants)
    for (const c of l.chapters) {
      const st = chapterStep(l, c, names)
      if (st.chapter.text.trim() && st.earlier.length) steps.push(st)
    }
  }
  return steps
}

const system = (s: Step) => (s.kind === 'character' ? CHARACTER_SYSTEM : CHAPTER_SYSTEM)
const stepTokens = (s: Step) => estimateTokens(system(s).length + JSON.stringify(SERIES_SCHEMA).length + s.input.length)
const routeCost = (route: Route | null, s: Step) => {
  const m = route && findModel(route.provider, route.model)
  return m ? costUsd(m, stepTokens(s), EST_OUTPUT) : 0
}

// ---------------------------------------------------------------------------
// Verification: every quote must be found word for word on both sides.
// ---------------------------------------------------------------------------
export function verifySeries(
  out: SeriesOutput,
  step: Step,
  characterName?: string,
): { findings: Array<FindingDraft & { chapter_id: string | null; scene_id: string | null }>; unverified: number } {
  const findings: Array<FindingDraft & { chapter_id: string | null; scene_id: string | null }> = []
  let unverified = 0
  for (const f of Array.isArray(out?.findings) ? out.findings.slice(0, 12) : []) {
    const ref = String(f.earlier_ref ?? '')
      .replace(/[[\]\s]/g, '')
      .toUpperCase()
    let original: { evidence: string; location: string; factIds: string[] } | null = null
    const pm = /^P(\d+)$/.exec(ref)
    const fm = /^F(\d+)$/.exec(ref)
    if (pm) {
      const p = step.earlier[Number(pm[1]) - 1]
      const at = p && locateExcerpt(p.text, String(f.earlier_excerpt ?? ''))
      if (p && at) original = { evidence: p.text.slice(at.start, at.end), location: where(p), factIds: [] }
    } else if (fm && step.kind === 'character') {
      const fact = step.facts[Number(fm[1]) - 1]
      if (fact) {
        const q = fact.fact_sources.find((x) => x.excerpt)?.excerpt
        original = {
          evidence: `${fact.attribute.replace(/_/g, ' ')}: ${fact.value}${q ? ` ("${q}")` : ''}`,
          location: fact.fact_sources[0]?.location_label || 'Story Bible',
          factIds: [fact.id],
        }
      }
    }
    let current: { evidence: string; loc: Loc } | null = null
    if (step.kind === 'character') {
      for (const p of step.current) {
        const at = locateExcerpt(p.text, String(f.current_excerpt ?? ''))
        if (at) {
          current = { evidence: p.text.slice(at.start, at.end), loc: p }
          break
        }
      }
    } else {
      const at = locateExcerpt(step.chapter.text, String(f.current_excerpt ?? ''))
      const span = at && step.chapter.spans.find((s) => at.start >= s.start && at.start < s.end)
      if (at && span) current = { evidence: step.chapter.text.slice(at.start, at.end), loc: span.loc }
    }
    if (!original || !current) {
      unverified++
      continue
    }
    const description = String(f.description ?? '').slice(0, 1000)
    findings.push({
      category: (CONTINUITY_CATEGORIES as readonly string[]).includes(f.category) ? f.category : 'contradictory_scene',
      severity: (['critical', 'warning', 'suggestion'] as const).find((s) => s === f.severity) ?? 'suggestion',
      description: characterName && !description.includes(characterName.split(' ')[0]) ? `${characterName}: ${description}` : description,
      original_evidence: original.evidence.slice(0, 3000),
      original_location: original.location,
      conflicting_evidence: current.evidence,
      conflicting_location: where(current.loc, false),
      suggested_resolution: String(f.suggested_resolution ?? '').slice(0, 1000),
      canon_fact_ids: original.factIds,
      chapter_id: current.loc.chapterId,
      scene_id: current.loc.sceneId,
    })
  }
  return { findings, unverified }
}

// ---------------------------------------------------------------------------
// Scan (free) and run (AI)
// ---------------------------------------------------------------------------
export interface SeriesScan {
  book: { id: string; title: string }
  series: Array<{ id: string; name: string; order: number | null }>
  earlier: EarlierBook[]
  shared: SharedCharacter[]
  duplicates: Array<{ name: string; ids: string[] }>
  chaptersToCheck: number
  estimate: { characters: number; chapters: number; costUsd: number; route: Route | null; allowed: boolean; reason?: string }
}

export async function scanSeries(db: SupabaseClient, bookId: string): Promise<SeriesScan> {
  const [l, settings, spent] = await Promise.all([load(db, bookId), loadSettings(db), spending(db)])
  const route = resolveRoute('continuity_check', settings.routing, availableProviders())
  const steps = buildSteps(l, null, true)
  const cost = steps.reduce((n, s) => n + routeCost(route, s), 0)
  let allowed = true
  let reason: string | undefined
  if (!l.series.length) {
    allowed = false
    reason = 'This book is not in a series yet. Add it to a series in Series & Universes, with its place in the reading order.'
  } else if (!l.earlier.length) {
    allowed = false
    reason = 'No earlier books in this series. Set the reading order in Series & Universes so this book comes after the ones it continues.'
  } else if (!steps.length) {
    allowed = false
    reason =
      'Nothing to compare yet: no characters from the earlier books are mentioned in this book, and no chapter shares names or places with them.'
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
  return {
    book: l.book,
    series: l.series,
    earlier: l.earlier,
    shared: l.shared.map(({ re: _re, variants: _v, ...s }) => s),
    duplicates: l.duplicates,
    chaptersToCheck: steps.filter((s) => s.kind === 'chapter').length,
    estimate: {
      characters: steps.filter((s) => s.kind === 'character').length,
      chapters: steps.filter((s) => s.kind === 'chapter').length,
      costUsd: cost,
      route,
      allowed,
      reason,
    },
  }
}

interface State {
  character_ids: string[] | null
  include_chapters: boolean
  steps_total: number
  done: string[]
  findings: number
  unverified_dropped: number
  declined: number
  current?: string
  model?: string
}

export async function runSeriesReview(
  db: SupabaseClient,
  bookId: string,
  action: 'start' | 'resume',
  opts: { characterIds: string[] | null; includeChapters: boolean },
  ctx: { continueLater?: () => Promise<void>; now?: () => number } = {},
): Promise<{ status: string }> {
  const now = ctx.now ?? Date.now
  const startedAt = now()
  const key = seriesKey(bookId)
  let { data: task } = await db.from('ai_tasks').select('*').eq('idempotency_key', key).maybeSingle()
  if (!task) {
    const ins = await db
      .from('ai_tasks')
      .insert({ task_type: 'series_review', idempotency_key: key, book_id: bookId, status: 'queued' })
      .select('*')
      .single()
    task = ins.error ? (await db.from('ai_tasks').select('*').eq('idempotency_key', key).single()).data : ins.data
  }
  if (!task) throw new HttpError(500, 'Could not create the series review job.')
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
    const characterIds = fresh ? opts.characterIds : (prev.character_ids ?? null)
    const includeChapters = fresh ? opts.includeChapters : (prev.include_chapters ?? true)
    const l = await load(db, bookId)
    const steps = buildSteps(l, characterIds, includeChapters)
    const settings = await loadSettings(db)
    const route = resolveRoute('continuity_check', settings.routing, availableProviders())
    const out: State = {
      character_ids: characterIds,
      include_chapters: includeChapters,
      steps_total: steps.length,
      done: (prev.done ?? []).filter((k) => steps.some((s) => s.key === k)),
      findings: prev.findings ?? 0,
      unverified_dropped: prev.unverified_dropped ?? 0,
      declined: prev.declined ?? 0,
      model: route?.model,
    }
    let spentTask = fresh ? 0 : Number(task.actual_cost_usd ?? 0)
    await db
      .from('ai_tasks')
      .update({
        status: 'running',
        error: null,
        input: { character_ids: characterIds, include_chapters: includeChapters },
        output: out,
        total_steps: steps.length,
        completed_steps: out.done.length,
        actual_cost_usd: spentTask,
        attempts: (task.attempts ?? 0) + 1,
        started_at: new Date(now()).toISOString(),
        completed_at: null,
      })
      .eq('id', task.id)

    if (!l.earlier.length || !steps.length) {
      await release({
        status: 'failed',
        output: out,
        error: !l.earlier.length
          ? 'No earlier books in this series to compare with.'
          : 'Nothing to compare: choose at least one shared character or include chapters.',
      })
      return { status: 'failed' }
    }
    if (!route) {
      await release({
        status: 'failed',
        output: out,
        error: 'AI is not set up on the server yet. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the Netlify environment variables.',
      })
      return { status: 'failed' }
    }
    const todo = steps.filter((s) => !out.done.includes(s.key))
    const pre = checkBudget(
      settings,
      await spending(db),
      spentTask,
      todo.reduce((n, s) => n + routeCost(route, s), 0),
    )
    if (todo.length && !pre.ok) {
      await release({ status: 'paused', output: out, error: pre.reason })
      return { status: 'paused' }
    }

    let stop: 'time' | 'paused' | 'cancelled' | 'fatal' | null = null
    let stopMessage = ''
    for (let i = 0; i < todo.length && !stop; i += CONCURRENCY) {
      if (now() - startedAt > RUN_BUDGET_MS) {
        stop = 'time'
        break
      }
      const { data: live } = await db.from('ai_tasks').select('status').eq('id', task.id).single()
      if (live?.status === 'cancelled') {
        stop = 'cancelled'
        break
      }
      const batch = todo.slice(i, i + CONCURRENCY)
      const b = checkBudget(
        settings,
        await spending(db),
        spentTask,
        batch.reduce((n, s) => n + routeCost(route, s), 0),
      )
      if (!b.ok) {
        stop = 'paused'
        stopMessage = b.reason!
        break
      }
      out.current = batch.map((s) => s.name).join(', ')
      await db.from('ai_tasks').update({ output: out }).eq('id', task.id)
      const results = await Promise.all(
        batch.map(async (s) => {
          try {
            const r = await runStructured<SeriesOutput>(db, {
              route,
              taskType: 'continuity_check',
              taskId: task!.id,
              request: {
                system: system(s),
                input: s.input,
                schema: SERIES_SCHEMA as unknown as Record<string, unknown>,
                schemaName: 'series_review',
                maxOutputTokens: 4000,
              },
            })
            const v = verifySeries(r.data, s, s.kind === 'character' ? s.name : undefined)
            return { key: s.key, cost: r.cost, drafts: v.findings, unverified: v.unverified, declined: false }
          } catch (err) {
            const cost = (err as { cost?: number }).cost ?? 0
            if (err instanceof ProviderDeclined) return { key: s.key, cost, drafts: [], unverified: 0, declined: true }
            console.error('series review step failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
            return {
              key: null,
              cost,
              drafts: [],
              unverified: 0,
              declined: false,
              fatal: err instanceof ProviderError && !err.retryable,
              message: err instanceof ProviderError ? err.message : 'A step could not be checked.',
            }
          }
        }),
      )
      // Saved one step at a time, so the same conflict found by two steps is kept once.
      for (const r of results) {
        spentTask += r.cost
        if (r.key) out.done.push(r.key)
        out.findings += await saveFindings(db, bookId, task.id, r.drafts)
        out.unverified_dropped += r.unverified
        if (r.declined) out.declined++
        if ('fatal' in r && r.fatal) {
          stop = 'fatal'
          stopMessage = r.message ?? ''
        }
      }
      out.current = undefined
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
      await release({ ...base, error: 'Stopped. Resume to finish the review.' })
      return { status: 'cancelled' }
    }
    if (stop === 'paused') {
      await release({ ...base, status: 'paused', error: stopMessage })
      return { status: 'paused' }
    }
    const left = steps.length - out.done.length
    if (stop === 'fatal' || left) {
      await release({
        ...base,
        status: 'failed',
        error: stop === 'fatal' ? stopMessage : `${left} ${left === 1 ? 'step' : 'steps'} could not be checked. Resume to try again.`,
      })
      return { status: 'failed' }
    }
    await release({
      ...base,
      status: 'completed',
      completed_steps: steps.length,
      completed_at: new Date(now()).toISOString(),
      error: out.declined ? `${out.declined} ${out.declined === 1 ? 'part was' : 'parts were'} declined by the AI provider and not checked.` : null,
    })
    return { status: 'completed' }
  } catch (err) {
    console.error('series review failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
    await release({ status: 'failed', error: err instanceof HttpError ? err.message : 'The review stopped unexpectedly. Resume to continue.' })
    return { status: 'failed' }
  }
}
