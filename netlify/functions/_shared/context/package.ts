// Retrieval-based memory: every AI request gets a controlled context package built from
// the database, never from chat history and never from every book at once.
//   1 task  2 book  3 connected series and universes  4 relevant approved canon
//   5 character states  6 timeline events  7 manuscript excerpts (full-text search)
//   8 style profile  9 outline and surrounding scenes  10 the author's answers to questions
// Each section has a size budget and keeps source references.
import type { SupabaseClient } from '@supabase/supabase-js'
import { chapterContext, characterNames, mentions, type CanonFactRow, type CharacterRow } from '../continuity/canon'
import { relatedBooks } from './related'
import { ageLabel, ageOn, effectiveDates, formatStoryDate, parseBirth } from '../../../../src/lib/story/dates'

export interface ContextSource {
  type: 'canon' | 'character_state' | 'event' | 'excerpt' | 'style' | 'outline' | 'decision'
  id: string
  label: string
}

export interface ContextPackage {
  text: string
  sources: ContextSource[]
  bookTitle: string
  styleProfileId: string | null
  relatedBookIds: string[]
  presentCharacters: string[]
}

export interface ContextRequest {
  bookId: string
  sceneId?: string | null
  /** The text the request is about: selection, scene, instruction, concept. */
  focusText: string
  task: string
  /** Use this profile instead of the book's chosen one. */
  styleProfileId?: string | null
  maxChars?: number
}

const BUDGET = { canon: 0.3, states: 0.08, events: 0.08, excerpts: 0.14, style: 0.1, outline: 0.18, decisions: 0.08, book: 0.04 }

function clip(lines: string[], budget: number): string[] {
  const out: string[] = []
  let used = 0
  for (const l of lines) {
    if (used + l.length + 1 > budget) break
    out.push(l)
    used += l.length + 1
  }
  return out
}

const safe = (s: string) => s.replace(/<\/?(manuscript|canon|context|instruction)[^>]*>/gi, '')

/** Turn a stored style profile into prompt guidance. Descriptions only, never quoted passages. */
export function styleText(p: { name: string; profile: Record<string, unknown> | null; summary: string | null; preferences: string | null }): string {
  const fields = Object.entries(p.profile ?? {})
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${String(v).trim()}`)
  return [
    `Style profile "${p.name}"`,
    p.summary ? `Summary: ${p.summary}` : '',
    ...fields,
    p.preferences ? `Author preferences (follow these first): ${p.preferences}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function buildContext(db: SupabaseClient, req: ContextRequest): Promise<ContextPackage> {
  const max = req.maxChars ?? 40_000
  const sources: ContextSource[] = []
  const { data: book } = await db
    .from('books')
    .select('id, title, subtitle, genre, subgenre, description, synopsis, content_rating, themes, tropes, style_profile_id, story_start_date')
    .eq('id', req.bookId)
    .single()
  if (!book) throw new Error('book not found')
  const related = await relatedBooks(db, req.bookId)

  // Scene neighborhood and outline.
  const { data: chapters } = await db
    .from('chapters')
    .select('id, title, position, summary, story_date, story_date_text, story_date_source')
    .eq('book_id', req.bookId)
    .order('position')
  const { data: scenes } = await db.from('scenes').select('id, chapter_id, title, position, summary, content_text').eq('book_id', req.bookId)
  const order = new Map((chapters ?? []).map((c) => [c.id as string, c.position as number]))
  const ordered = [...(scenes ?? [])].sort((a, b) => (order.get(a.chapter_id) ?? 0) - (order.get(b.chapter_id) ?? 0) || a.position - b.position)
  const idx = req.sceneId ? ordered.findIndex((s) => s.id === req.sceneId) : -1
  const current = idx >= 0 ? ordered[idx] : null
  const prev = idx > 0 ? ordered[idx - 1] : null
  const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null

  const focus = [req.focusText, current?.content_text?.slice(-6000) ?? ''].join('\n')

  const [{ data: chars }, factsRes, { data: profile }, { data: questions }] = await Promise.all([
    db.from('characters').select('id, full_name, preferred_name, aliases, nicknames, date_of_birth, age, residence').limit(5000),
    db
      .from('canon_facts')
      .select(
        'id, book_id, entity_type, entity_id, entity_label, attribute, value, statement_type, payload, fact_sources(excerpt, location_label, book_id)',
      )
      .in('book_id', related)
      .eq('status', 'approved')
      .in('entity_type', ['character', 'relationship', 'world_element', 'story_event'])
      .limit(5000),
    req.styleProfileId !== undefined || book.style_profile_id
      ? db
          .from('writing_profiles')
          .select('id, name, profile, summary, preferences')
          .eq('id', req.styleProfileId ?? book.style_profile_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from('clarification_questions')
      .select('id, question, answer, status, is_provisional')
      .eq('book_id', req.bookId)
      .in('status', ['answered', 'ai_decided'])
      .order('answered_at', { ascending: false })
      .limit(40),
  ])
  const characters = (chars ?? []) as Array<CharacterRow & { date_of_birth: string | null; age: string | null; residence: string | null }>
  const facts = (factsRes.data ?? []) as unknown as CanonFactRow[]
  const { data: books } = await db.from('books').select('id, title').in('id', related)
  const titles = new Map((books ?? []).map((b) => [b.id as string, b.title as string]))

  const names = characterNames(characters)
  const present = characters.filter((c) => (names.get(c.id) ?? []).some((n) => mentions(focus, n)))
  const presentIds = new Set(present.map((c) => c.id))

  const sections: string[] = []
  const push = (title: string, lines: string[]) => lines.length && sections.push(`## ${title}\n${lines.join('\n')}`)

  // 2. The book.
  push(
    'This book',
    clip(
      [
        `Title: ${book.title}${book.subtitle ? `: ${book.subtitle}` : ''}`,
        book.genre ? `Genre: ${book.genre}${book.subgenre ? ` / ${book.subgenre}` : ''}` : '',
        `Audience: ${String(book.content_rating).replace('_', ' ')}`,
        book.description ? `Description: ${safe(book.description)}` : '',
        book.synopsis ? `Synopsis: ${safe(book.synopsis)}` : '',
        book.themes?.length ? `Themes: ${book.themes.join(', ')}` : '',
        book.tropes?.length ? `Tropes: ${book.tropes.join(', ')}` : '',
      ].filter(Boolean),
      max * BUDGET.book,
    ),
  )

  // 3. When this scene happens, and how old the people in it are on that date.
  {
    const texts = new Map<string, string>()
    for (const sc of ordered) texts.set(sc.chapter_id, `${texts.get(sc.chapter_id) ?? ''}\n\n${sc.content_text ?? ''}`)
    const dates = effectiveDates(
      (chapters ?? []).map((c) => ({ ...c, text: texts.get(c.id) ?? '' })),
      (book.story_start_date as string | null) ?? null,
    )
    const here = current ? dates.find((d) => d.id === current.chapter_id) : (dates.find((d) => d.date) ?? null)
    const lines: string[] = []
    if (here?.date)
      lines.push(
        `Story date of ${current ? 'this chapter' : 'the book'}: ${formatStoryDate(here.date)} (${here.note}). Keep every age, season and day consistent with it.`,
      )
    for (const c of characters.filter((x) => presentIds.has(x.id))) {
      const birth = parseBirth(c.date_of_birth)
      const age = birth && here?.date ? ageOn(birth, here.date) : null
      const parts = [
        age ? `age ${ageLabel(age)} on this date (born ${formatStoryDate(birth!.iso, birth!.precision)})` : c.age ? `age ${c.age} (profile)` : '',
        c.residence ? `lives in ${c.residence}` : '',
      ].filter(Boolean)
      if (parts.length) lines.push(`${c.full_name}: ${safe(parts.join('; '))}`)
    }
    push('Story date, ages and homes', clip(lines, max * BUDGET.states))
  }

  // 4. Canon about the people, places and events in focus.
  const canon = chapterContext(focus, facts, characters, titles, req.bookId, 150)
  const canonLines = clip(
    canon.map((c) => c.line),
    max * BUDGET.canon,
  )
  for (const c of canon.slice(0, canonLines.length))
    sources.push({ type: 'canon', id: c.fact.id, label: `${c.fact.entity_label}: ${c.fact.attribute}` })
  push('Established canon (approved by the author)', canonLines)

  // 5. Character states over time.
  if (presentIds.size) {
    const { data: states } = await db
      .from('character_states')
      .select('id, character_id, book_id, attribute, value, period_label')
      .in('character_id', [...presentIds])
      .in('book_id', related)
      .order('created_at')
      .limit(300)
    const charName = new Map(characters.map((c) => [c.id, c.full_name]))
    const lines = clip(
      (states ?? []).map(
        (s) =>
          `${charName.get(s.character_id)} | ${String(s.attribute).replace(/_/g, ' ')}: ${s.value} (${titles.get(s.book_id) ?? 'book'}${s.period_label ? `, ${s.period_label}` : ''})`,
      ),
      max * BUDGET.states,
    )
    for (const s of (states ?? []).slice(0, lines.length)) sources.push({ type: 'character_state', id: s.id, label: s.attribute })
    push('Character details by book (later books may change them)', lines)
  }

  // 6. Timeline.
  const { data: events } = await db
    .from('story_events')
    .select(
      'id, title, description, approximate_label, date_start, is_flashback, reliability, book_id, chronological_order, story_event_characters(character_id)',
    )
    .in('book_id', related)
    .order('chronological_order', { ascending: true, nullsFirst: false })
    .limit(400)
  const relevantEvents = (events ?? []).filter(
    (e) => e.book_id === req.bookId || (e.story_event_characters as Array<{ character_id: string }>).some((c) => presentIds.has(c.character_id)),
  )
  const eventLines = clip(
    relevantEvents.map(
      (e) =>
        `${e.date_start ?? e.approximate_label ?? 'undated'}: ${e.title}${e.description ? ` (${safe(e.description).slice(0, 200)})` : ''}${e.is_flashback ? ' [flashback]' : ''}${e.reliability !== 'confirmed' ? ` [${e.reliability}]` : ''} (${titles.get(e.book_id) ?? ''})`,
    ),
    max * BUDGET.events,
  )
  for (const e of relevantEvents.slice(0, eventLines.length)) sources.push({ type: 'event', id: e.id, label: e.title })
  push('Timeline', eventLines)

  // 7. Manuscript excerpts that mention the same characters, from connected books (full-text search).
  if (present.length) {
    const terms = present
      .slice(0, 6)
      .map((c) => `"${c.full_name.replace(/["']/g, '')}"`)
      .join(' or ')
    const { data: hits } = await db
      .from('scenes')
      .select('id, book_id, title, content_text')
      .in('book_id', related)
      .neq('id', req.sceneId ?? '00000000-0000-0000-0000-000000000000')
      .textSearch('search', terms, { type: 'websearch', config: 'english' })
      .limit(8)
    const lines: string[] = []
    for (const h of hits ?? []) {
      const text = String(h.content_text ?? '')
      const at = Math.max(0, Math.min(...present.map((c) => text.indexOf(c.full_name)).filter((i) => i >= 0), text.length) - 200)
      lines.push(`[${titles.get(h.book_id) ?? 'book'}, ${h.title}] ${safe(text.slice(at, at + 700)).replace(/\s+/g, ' ')}`)
      sources.push({ type: 'excerpt', id: h.id, label: `${titles.get(h.book_id) ?? ''}: ${h.title}` })
    }
    push('Earlier passages for reference only (never copy them)', clip(lines, max * BUDGET.excerpts))
  }

  // 8. Style.
  if (profile) {
    sources.push({ type: 'style', id: profile.id, label: profile.name })
    push('Writing style to follow', clip(styleText(profile as never).split('\n'), max * BUDGET.style))
  }

  // 9. Outline and the scenes around this one.
  const outline = (chapters ?? []).map((c, i) => `${i + 1}. ${c.title}${c.summary ? `: ${safe(c.summary)}` : ''}`)
  const near: string[] = []
  if (current) {
    const chapterScenes = ordered.filter((s) => s.chapter_id === current.chapter_id)
    near.push(`Current chapter scenes: ${chapterScenes.map((s) => (s.id === current.id ? `[${s.title} (this scene)]` : s.title)).join(', ')}`)
    if (prev?.content_text) near.push(`End of the previous scene (${prev.title}): ...${safe(prev.content_text.slice(-1500))}`)
    if (next?.content_text) near.push(`Start of the next scene (${next.title}): ${safe(next.content_text.slice(0, 600))}...`)
  }
  const outlineLines = clip([...outline, ...near], max * BUDGET.outline)
  if (outlineLines.length) sources.push({ type: 'outline', id: req.bookId, label: 'Outline' })
  push('Outline', outlineLines)

  // 10. Decisions the author made (and provisional ones the AI made).
  const qa = (questions ?? []).filter((q) => q.answer)
  const qaLines = clip(
    qa.map((q) => `Q: ${safe(q.question)} A: ${safe(q.answer!)}${q.is_provisional ? ' (provisional AI decision, not confirmed)' : ''}`),
    max * BUDGET.decisions,
  )
  for (const q of qa.slice(0, qaLines.length)) sources.push({ type: 'decision', id: q.id, label: q.question.slice(0, 80) })
  push('Decisions already made (do not ask about these again)', qaLines)

  const text = `<context task="${req.task}">\n${sections.join('\n\n')}\n</context>`.slice(0, max + 200)
  return {
    text,
    sources,
    bookTitle: book.title,
    styleProfileId: profile?.id ?? null,
    relatedBookIds: related,
    presentCharacters: present.map((c) => c.full_name),
  }
}
