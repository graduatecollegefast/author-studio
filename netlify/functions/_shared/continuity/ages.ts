// Free age check for one book: every age the narration gives a character, and every
// profile age, against their birth date on the chapter's story date. No AI involved.
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkAges, effectiveDates, type AgeCheckCharacter } from '../../../../src/lib/story/dates'
import { ambiguousFirstNames, nameVariants } from '../series/text'
import type { FindingDraft } from './canon'

interface Chapter {
  id: string
  title: string
  position: number
  story_date: string | null
  story_date_text: string | null
  story_date_source: 'detected' | 'author' | null
  scenes: Array<{ id: string; title: string; position: number; content_text: string }>
}

export async function ageFindings(
  db: SupabaseClient,
  bookId: string,
): Promise<Array<FindingDraft & { chapter_id: string | null; scene_id: string | null }>> {
  const [{ data: book }, { data: chapters }, { data: chars }, { data: apps }] = await Promise.all([
    db.from('books').select('story_start_date').eq('id', bookId).maybeSingle(),
    db
      .from('chapters')
      .select('id, title, position, story_date, story_date_text, story_date_source, scenes(id, title, position, content_text)')
      .eq('book_id', bookId)
      .order('position'),
    db.from('characters').select('id, full_name, preferred_name, aliases, nicknames, date_of_birth, age, first_appearance_book_id').limit(5000),
    db.from('character_appearances').select('character_id').eq('book_id', bookId).limit(10000),
  ])
  const rows = ((chapters ?? []) as Chapter[]).map((c) => ({ ...c, scenes: [...c.scenes].sort((a, b) => a.position - b.position) }))
  const dates = effectiveDates(
    rows.map((c) => ({ ...c, text: c.scenes.map((s) => s.content_text ?? '').join('\n\n') })),
    (book?.story_start_date as string | null) ?? null,
  )
  const all = (chars ?? []) as Array<{
    id: string
    full_name: string
    preferred_name: string | null
    aliases: string[] | null
    nicknames: string[] | null
    date_of_birth: string | null
    age: string | null
    first_appearance_book_id: string | null
  }>
  const linked = new Set([
    ...(apps ?? []).map((a) => a.character_id as string),
    ...all.filter((c) => c.first_appearance_book_id === bookId).map((c) => c.id),
  ])
  const ambiguous = ambiguousFirstNames(all)
  const characters: AgeCheckCharacter[] = all
    .filter((c) => c.date_of_birth?.trim())
    .map((c) => ({
      id: c.id,
      name: c.full_name,
      names: nameVariants(c, ambiguous),
      dateOfBirth: c.date_of_birth,
      // Profile ages are compared only for characters in this book.
      age: linked.has(c.id) ? c.age : null,
    }))
  if (!characters.length) return []
  const issues = checkAges(
    rows.map((c, i) => ({
      id: c.id,
      title: c.title,
      date: dates[i].date,
      dateNote: dates[i].note,
      scenes: c.scenes.map((s) => ({ id: s.id, title: s.title, text: s.content_text ?? '' })),
    })),
    characters,
    (book?.story_start_date as string | null) ?? null,
  )
  return issues.map((i) => ({
    category: 'age',
    severity: i.severity,
    description: i.description,
    original_evidence: i.established,
    original_location: i.establishedWhere,
    conflicting_evidence: i.conflicting,
    conflicting_location: i.conflictingWhere,
    suggested_resolution: i.fix,
    canon_fact_ids: [],
    chapter_id: i.chapterId,
    scene_id: i.sceneId,
  }))
}
