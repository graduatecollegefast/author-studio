// Build export documents from the author's data. Every query runs as the signed-in author.
import type { SupabaseClient } from '@supabase/supabase-js'
import { eventDateLabel, sortEvents, type StoryEvent } from '../../../../src/lib/story/timeline'
import { HttpError } from '../http'
import { field, p, tiptapToBlocks, type ExportBlock, type ExportDoc, type ExportSection } from './model'

export const CONTENT_TYPES = [
  'manuscript',
  'chapters',
  'outline',
  'character_profiles',
  'character_bible',
  'world_bible',
  'series_overview',
  'timeline',
  'notes',
  'backup',
] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

export interface ExportOptions {
  content: ContentType
  bookId?: string | null
  seriesId?: string | null
  chapterIds?: string[]
  characterIds?: string[]
}

export const CONTENT_LABELS: Record<ContentType, string> = {
  manuscript: 'Complete manuscript',
  chapters: 'Selected chapters',
  outline: 'Book outline',
  character_profiles: 'Character profiles',
  character_bible: 'Character Bible',
  world_bible: 'World Bible',
  series_overview: 'Series overview',
  timeline: 'Story timeline',
  notes: 'Project notes',
  backup: 'Complete project backup',
}

const human = (k: string) => {
  const s = k.replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const list = (v: unknown) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : '')

/** Readable lines from a JSON object of profile fields. */
function jsonFields(v: unknown): ExportBlock[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return []
  return Object.entries(v as Record<string, unknown>).flatMap(([k, val]) =>
    field(human(k), Array.isArray(val) ? list(val) : val && typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')),
  )
}

interface Book {
  id: string
  title: string
  subtitle: string | null
  pen_name: string | null
  description: string | null
  synopsis: string | null
  genre: string | null
  author_notes: string | null
  word_count: number
}

async function getBook(db: SupabaseClient, bookId: string | null | undefined): Promise<Book> {
  if (!bookId) throw new HttpError(400, 'Choose a book.')
  const { data } = await db
    .from('books')
    .select('id, title, subtitle, pen_name, description, synopsis, genre, author_notes, word_count')
    .eq('id', bookId)
    .maybeSingle()
  if (!data) throw new HttpError(404, 'Book not found.')
  return data as Book
}

async function authorName(db: SupabaseClient, book?: Book): Promise<string | null> {
  if (book?.pen_name) return book.pen_name
  const { data } = await db.from('profiles').select('display_name').maybeSingle()
  return (data?.display_name as string | null) ?? null
}

interface ChapterRow {
  id: string
  title: string
  position: number
  summary: string | null
  scenes: Array<{ id: string; title: string; position: number; summary: string | null; content: unknown; word_count: number }>
}

async function chapters(db: SupabaseClient, bookId: string, ids?: string[]): Promise<ChapterRow[]> {
  let q = db
    .from('chapters')
    .select('id, title, position, summary, scenes(id, title, position, summary, content, word_count)')
    .eq('book_id', bookId)
    .order('position')
  if (ids?.length) q = q.in('id', ids)
  const { data, error } = await q
  if (error) throw new Error(`load chapters: ${error.message}`)
  return ((data ?? []) as ChapterRow[]).map((c) => ({ ...c, scenes: [...c.scenes].sort((a, b) => a.position - b.position) }))
}

/** Chapter text in order. Scenes after the first are separated by a scene break. */
function chapterBlocks(c: ChapterRow): ExportBlock[] {
  const out: ExportBlock[] = []
  c.scenes.forEach((s, i) => {
    const blocks = tiptapToBlocks(s.content)
    if (!blocks.length) return
    if (i > 0 && out.length && out[out.length - 1].kind !== 'break' && blocks[0].kind !== 'break') out.push({ kind: 'break' })
    out.push(...blocks)
  })
  return out
}

async function manuscript(db: SupabaseClient, o: ExportOptions): Promise<ExportDoc> {
  const book = await getBook(db, o.bookId)
  const rows = await chapters(db, book.id, o.content === 'chapters' ? o.chapterIds : undefined)
  if (o.content === 'chapters' && !o.chapterIds?.length) throw new HttpError(400, 'Choose at least one chapter.')
  if (!rows.length) throw new HttpError(400, 'This book has no chapters to export yet.')
  return {
    title: book.title,
    subtitle: book.subtitle,
    author: await authorName(db, book),
    sections: rows.map((c) => ({ title: c.title, blocks: chapterBlocks(c) })),
  }
}

async function outline(db: SupabaseClient, o: ExportOptions): Promise<ExportDoc> {
  const book = await getBook(db, o.bookId)
  const rows = await chapters(db, book.id)
  const overview: ExportBlock[] = [
    ...field('Genre', book.genre),
    ...field('Words', book.word_count ? book.word_count.toLocaleString('en-US') : null),
    ...field('Chapters', String(rows.length)),
  ]
  if (book.description) overview.push({ kind: 'heading', level: 2, text: 'Description' }, p(book.description))
  if (book.synopsis) overview.push({ kind: 'heading', level: 2, text: 'Synopsis' }, ...book.synopsis.split(/\n{2,}/).map((t) => p(t.trim())))
  const sections: ExportSection[] = [{ title: 'Overview', blocks: overview }]
  sections.push({
    title: 'Chapter outline',
    blocks: rows.flatMap((c, i) => [
      { kind: 'heading' as const, level: 2 as const, text: `${i + 1}. ${c.title}` },
      ...(c.summary ? [p(c.summary)] : []),
      ...c.scenes.flatMap((s) => [
        {
          kind: 'paragraph' as const,
          style: 'meta' as const,
          runs: [{ text: s.title, bold: true }, { text: ` (${s.word_count.toLocaleString('en-US')} words)` }],
        },
        ...(s.summary ? [p(s.summary, 'quote')] : []),
      ]),
    ]),
  })
  return { title: `${book.title}: Outline`, author: await authorName(db, book), sections }
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------
const CHARACTER_TEXT = [
  ['preferred_name', 'Preferred name'],
  ['pronouns', 'Pronouns'],
  ['age', 'Age'],
  ['date_of_birth', 'Date of birth'],
  ['role', 'Story role'],
  ['occupation', 'Occupation'],
  ['education', 'Education'],
  ['gender_identity', 'Gender identity'],
  ['sexual_orientation', 'Sexual orientation'],
  ['romantic_orientation', 'Romantic orientation'],
] as const

async function bookCharacterIds(db: SupabaseClient, bookId: string): Promise<string[]> {
  const [{ data: apps }, { data: first }, { data: unis }] = await Promise.all([
    db.from('character_appearances').select('character_id').eq('book_id', bookId).limit(10000),
    db.from('characters').select('id').eq('first_appearance_book_id', bookId),
    db.from('book_universes').select('universe_id').eq('book_id', bookId),
  ])
  const ids = new Set<string>([...(apps ?? []).map((a) => a.character_id as string), ...(first ?? []).map((c) => c.id as string)])
  const uni = (unis ?? []).map((u) => u.universe_id as string)
  if (uni.length) {
    const { data } = await db.from('characters').select('id').in('universe_id', uni)
    for (const c of data ?? []) ids.add(c.id as string)
  }
  return [...ids]
}

async function characterSections(db: SupabaseClient, ids: string[], full: boolean): Promise<ExportSection[]> {
  if (!ids.length) return []
  const { data, error } = await db.from('characters').select('*').in('id', ids.slice(0, 2000)).order('full_name')
  if (error) throw new Error(`load characters: ${error.message}`)
  const chars = (data ?? []) as Array<Record<string, unknown> & { id: string; full_name: string }>
  const names = new Map(chars.map((c) => [c.id, c.full_name]))
  const [{ data: states }, { data: rels }, { data: facts }] = full
    ? await Promise.all([
        db
          .from('character_states')
          .select('character_id, attribute, value, period_label')
          .in('character_id', ids)
          .order('valid_from_position', { nullsFirst: false }),
        db
          .from('relationships')
          .select('character_a_id, character_b_id, category, custom_label, current_status, description')
          .or(`character_a_id.in.(${ids.join(',')}),character_b_id.in.(${ids.join(',')})`),
        db
          .from('canon_facts')
          .select('entity_id, attribute, value')
          .eq('entity_type', 'character')
          .eq('status', 'approved')
          .in('entity_id', ids)
          .limit(10000),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]
  const otherIds = new Set<string>()
  for (const r of rels ?? [])
    for (const k of ['character_a_id', 'character_b_id'] as const) if (!names.has(r[k] as string)) otherIds.add(r[k] as string)
  if (otherIds.size) {
    const { data: others } = await db
      .from('characters')
      .select('id, full_name')
      .in('id', [...otherIds])
    for (const c of others ?? []) names.set(c.id as string, c.full_name as string)
  }
  return chars.map((c) => {
    const blocks: ExportBlock[] = [
      ...CHARACTER_TEXT.flatMap(([k, label]) => field(label, c[k] as string | null)),
      ...field('Nicknames', list(c.nicknames)),
      ...field('Aliases', list(c.aliases)),
    ]
    for (const [k, label] of [
      ['appearance', 'Appearance'],
      ['personality', 'Personality'],
      ['history', 'History'],
      ['custom_fields', 'More details'],
    ] as const) {
      const lines = jsonFields(c[k])
      if (lines.length) blocks.push({ kind: 'heading', level: 2, text: label }, ...lines)
    }
    if (c.notes)
      blocks.push(
        { kind: 'heading', level: 2, text: 'Notes' },
        ...String(c.notes)
          .split(/\n{2,}/)
          .map((t) => p(t.trim())),
      )
    const st = (states ?? []).filter((s) => s.character_id === c.id)
    if (st.length)
      blocks.push(
        { kind: 'heading', level: 2, text: 'Changes over time' },
        ...st.flatMap((s) => field(`${human(String(s.attribute))}${s.period_label ? ` (${s.period_label})` : ''}`, String(s.value))),
      )
    const rs = (rels ?? []).filter((r) => r.character_a_id === c.id || r.character_b_id === c.id)
    if (rs.length)
      blocks.push(
        { kind: 'heading', level: 2, text: 'Relationships' },
        ...rs.flatMap((r) => {
          const other = names.get((r.character_a_id === c.id ? r.character_b_id : r.character_a_id) as string) ?? 'Unknown'
          const label = (r.custom_label as string) || human(String(r.category ?? 'relationship'))
          return field(other, [label, r.current_status ? `currently ${r.current_status}` : null, r.description].filter(Boolean).join('. '))
        }),
      )
    const fs = (facts ?? []).filter((f) => f.entity_id === c.id)
    if (fs.length)
      blocks.push(
        { kind: 'heading', level: 2, text: 'Approved canon' },
        ...fs.slice(0, 200).flatMap((f) => field(human(String(f.attribute)), String(f.value))),
      )
    if (!blocks.length) blocks.push(p('No details yet.', 'meta'))
    return { title: c.full_name, blocks }
  })
}

async function characterDoc(db: SupabaseClient, o: ExportOptions): Promise<ExportDoc> {
  if (o.content === 'character_profiles') {
    if (!o.characterIds?.length) throw new HttpError(400, 'Choose at least one character.')
    const book = o.bookId ? await getBook(db, o.bookId) : undefined
    const sections = await characterSections(db, o.characterIds, true)
    if (!sections.length) throw new HttpError(404, 'Those characters were not found.')
    return {
      title: sections.length === 1 ? sections[0].title : 'Character profiles',
      subtitle: book?.title ?? null,
      author: await authorName(db, book),
      sections,
    }
  }
  const book = await getBook(db, o.bookId)
  const sections = await characterSections(db, await bookCharacterIds(db, book.id), true)
  if (!sections.length) throw new HttpError(400, 'No characters are linked to this book yet.')
  return { title: `${book.title}: Character Bible`, author: await authorName(db, book), description: `${sections.length} characters`, sections }
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
async function worldBible(db: SupabaseClient, o: ExportOptions): Promise<ExportDoc> {
  const book = await getBook(db, o.bookId)
  const [{ data: links }, { data: unis }] = await Promise.all([
    db.from('world_element_links').select('world_element_id').eq('book_id', book.id).limit(10000),
    db.from('book_universes').select('universe_id').eq('book_id', book.id),
  ])
  const ids = new Set((links ?? []).map((l) => l.world_element_id as string))
  const uni = (unis ?? []).map((u) => u.universe_id as string)
  let q = db.from('world_elements').select('id, name, category, description, history, rules, notes').order('name').limit(3000)
  q = uni.length
    ? q.or(`id.in.(${[...ids].join(',') || '00000000-0000-0000-0000-000000000000'}),universe_id.in.(${uni.join(',')})`)
    : q.in('id', [...ids])
  const { data: els, error } = await q
  if (error) throw new Error(`load world: ${error.message}`)
  if (!els?.length) throw new HttpError(400, 'No world elements are linked to this book yet.')
  const byCat = new Map<string, typeof els>()
  for (const e of els) byCat.set(e.category as string, [...(byCat.get(e.category as string) ?? []), e])
  const sections = [...byCat.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, items]) => ({
      title: human(cat),
      blocks: items.flatMap((e) => [
        { kind: 'heading' as const, level: 2 as const, text: e.name as string },
        ...(e.description ? [p(e.description as string)] : []),
        ...field('History', e.history as string | null),
        ...field('Rules', e.rules as string | null),
        ...field('Notes', e.notes as string | null),
      ]),
    }))
  return { title: `${book.title}: World Bible`, author: await authorName(db, book), description: `${els.length} elements`, sections }
}

// ---------------------------------------------------------------------------
// Series overview
// ---------------------------------------------------------------------------
async function seriesOverview(db: SupabaseClient, o: ExportOptions): Promise<ExportDoc> {
  if (!o.seriesId) throw new HttpError(400, 'Choose a series.')
  const { data: s } = await db
    .from('series')
    .select('id, name, description, genre, planned_book_count, status, notes')
    .eq('id', o.seriesId)
    .maybeSingle()
  if (!s) throw new HttpError(404, 'Series not found.')
  const [{ data: sb }, { data: threads }] = await Promise.all([
    db
      .from('series_books')
      .select(
        'reading_order, chronological_order, publication_order, books!series_books_book_id_owner_id_fkey(id, title, subtitle, description, word_count, writing_status, publication_status)',
      )
      .eq('series_id', s.id),
    db.from('plot_threads').select('title, description, status, kind').eq('series_id', s.id).order('position'),
  ])
  type B = {
    id: string
    title: string
    subtitle: string | null
    description: string | null
    word_count: number
    writing_status: string | null
    publication_status: string | null
  }
  const books = ((sb ?? []) as unknown as Array<{ reading_order: number | null; books: B | null }>)
    .filter((r) => r.books)
    .sort((a, b) => (a.reading_order ?? 1e9) - (b.reading_order ?? 1e9) || a.books!.title.localeCompare(b.books!.title))
  const overview: ExportBlock[] = [
    ...field('Genre', s.genre as string | null),
    ...field('Status', s.status ? human(String(s.status)) : null),
    ...field('Planned books', s.planned_book_count ? String(s.planned_book_count) : null),
    ...field('Books so far', String(books.length)),
    ...field('Total words', books.reduce((n, b) => n + (b.books!.word_count ?? 0), 0).toLocaleString('en-US')),
  ]
  if (s.description) overview.push(p(s.description as string))
  if (s.notes) overview.push({ kind: 'heading', level: 2, text: 'Notes' }, p(s.notes as string))
  const sections: ExportSection[] = [{ title: 'Overview', blocks: overview }]
  sections.push({
    title: 'Books in reading order',
    blocks: books.length
      ? books.flatMap((r, i) => [
          { kind: 'heading' as const, level: 2 as const, text: `${i + 1}. ${r.books!.title}` },
          ...field('Subtitle', r.books!.subtitle),
          ...field('Words', r.books!.word_count ? r.books!.word_count.toLocaleString('en-US') : null),
          ...field('Writing status', r.books!.writing_status ? human(r.books!.writing_status) : null),
          ...(r.books!.description ? [p(r.books!.description)] : []),
        ])
      : [p('No books are in this series yet.', 'meta')],
  })
  if (threads?.length)
    sections.push({
      title: 'Plot threads and arcs',
      blocks: threads.flatMap((t) => [
        { kind: 'heading' as const, level: 2 as const, text: t.title as string },
        ...field('Type', human(String(t.kind ?? 'thread'))),
        ...field('Status', human(String(t.status ?? ''))),
        ...(t.description ? [p(t.description as string)] : []),
      ]),
    })
  return { title: s.name as string, subtitle: 'Series overview', author: await authorName(db), sections }
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
async function timeline(db: SupabaseClient, o: ExportOptions): Promise<ExportDoc> {
  const book = await getBook(db, o.bookId)
  const { data, error } = await db.from('story_events').select('*, story_event_characters(character_id)').eq('book_id', book.id).limit(5000)
  if (error) throw new Error(`load events: ${error.message}`)
  const events = sortEvents(
    ((data ?? []) as StoryEvent[]).map((e) => ({ ...e, relationship_events: [] })),
    'chronological',
  )
  if (!events.length) throw new HttpError(400, 'This book has no timeline events yet.')
  const charIds = [...new Set(events.flatMap((e) => e.story_event_characters.map((c) => c.character_id)))]
  const { data: chars } = charIds.length ? await db.from('characters').select('id, full_name').in('id', charIds) : { data: [] }
  const names = new Map((chars ?? []).map((c) => [c.id as string, c.full_name as string]))
  return {
    title: `${book.title}: Story timeline`,
    author: await authorName(db, book),
    description: 'Events in story order',
    sections: [
      {
        title: 'Story order',
        blocks: events.flatMap((e) => [
          { kind: 'heading' as const, level: 2 as const, text: e.title },
          ...field('When', eventDateLabel(e) || 'Undated'),
          ...field('Type', e.event_type ? human(e.event_type) : null),
          ...field(
            'Characters',
            e.story_event_characters
              .map((c) => names.get(c.character_id))
              .filter(Boolean)
              .join(', '),
          ),
          ...(e.is_flashback ? field('Shown as', 'Flashback') : []),
          ...(e.reliability !== 'confirmed' ? field('Reliability', human(e.reliability)) : []),
          ...(e.description ? [p(e.description)] : []),
          ...field('Notes', e.notes),
        ]),
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Project notes
// ---------------------------------------------------------------------------
async function notes(db: SupabaseClient, o: ExportOptions): Promise<ExportDoc> {
  const book = await getBook(db, o.bookId)
  const [{ data: ideas }, { data: qs }, { data: plans }] = await Promise.all([
    db.from('ideas').select('title, description, category, status, tags').eq('book_id', book.id).order('created_at'),
    db
      .from('clarification_questions')
      .select('question, answer, chosen_option, status')
      .eq('book_id', book.id)
      .in('status', ['answered', 'ai_decided'])
      .order('answered_at'),
    db
      .from('story_plans')
      .select('kind, title, content, status')
      .eq('book_id', book.id)
      .in('kind', ['concept', 'premise', 'character_arcs', 'outline'])
      .order('created_at'),
  ])
  const sections: ExportSection[] = []
  const para = (t: string) =>
    t
      .split(/\n{2,}/)
      .map((x) => p(x.trim()))
      .filter((b) => b.kind !== 'paragraph' || b.runs[0].text)
  if (book.author_notes) sections.push({ title: 'Author notes', blocks: para(book.author_notes) })
  if (book.synopsis) sections.push({ title: 'Synopsis', blocks: para(book.synopsis) })
  if (plans?.length)
    sections.push({
      title: 'Story plans',
      blocks: plans.flatMap((pl) => [
        { kind: 'heading' as const, level: 2 as const, text: (pl.title as string) || human(String(pl.kind)) },
        ...para(String(pl.content ?? '')),
      ]),
    })
  if (qs?.length)
    sections.push({
      title: 'Decisions',
      blocks: qs.flatMap((q) => [
        { kind: 'paragraph' as const, style: 'meta' as const, runs: [{ text: String(q.question), bold: true }] },
        p(String(q.answer || q.chosen_option || '')),
      ]),
    })
  if (ideas?.length)
    sections.push({
      title: 'Ideas',
      blocks: ideas.flatMap((i) => [
        { kind: 'heading' as const, level: 2 as const, text: i.title as string },
        ...field('Category', i.category ? human(String(i.category)) : null),
        ...field('Status', i.status ? human(String(i.status)) : null),
        ...field('Tags', list(i.tags)),
        ...(i.description ? para(String(i.description)) : []),
      ]),
    })
  if (!sections.length) throw new HttpError(400, 'This book has no notes, plans, decisions or ideas yet.')
  return { title: `${book.title}: Project notes`, author: await authorName(db, book), sections }
}

export async function buildDoc(db: SupabaseClient, o: ExportOptions): Promise<ExportDoc> {
  switch (o.content) {
    case 'manuscript':
    case 'chapters':
      return manuscript(db, o)
    case 'outline':
      return outline(db, o)
    case 'character_profiles':
    case 'character_bible':
      return characterDoc(db, o)
    case 'world_bible':
      return worldBible(db, o)
    case 'series_overview':
      return seriesOverview(db, o)
    case 'timeline':
      return timeline(db, o)
    case 'notes':
      return notes(db, o)
    default:
      throw new HttpError(400, 'Unknown export type.')
  }
}
