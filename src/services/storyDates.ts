import { supabase } from '@/lib/supabase/client'
import type { EffectiveDate } from '@/lib/story/dates'
import { throwIfError } from './errors'

export interface DatedChapter {
  id: string
  title: string
  position: number
  story_date: string | null
  story_date_text: string | null
  story_date_source: 'detected' | 'author' | null
  scenes: Array<{ id: string; title: string; position: number; content_text: string }>
}

export interface BookCharacter {
  id: string
  full_name: string
  preferred_name: string | null
  aliases: string[]
  nicknames: string[]
  date_of_birth: string | null
  age: string | null
  residence: string | null
}

export interface StoryDatesData {
  start: string | null
  chapters: DatedChapter[]
  characters: BookCharacter[]
}

export async function loadStoryDates(bookId: string): Promise<StoryDatesData> {
  const [{ data: book, error: be }, { data: chapters, error: ce }, { data: apps }] = await Promise.all([
    supabase.from('books').select('story_start_date').eq('id', bookId).single(),
    supabase
      .from('chapters')
      .select('id, title, position, story_date, story_date_text, story_date_source, scenes(id, title, position, content_text)')
      .eq('book_id', bookId)
      .order('position'),
    supabase.from('character_appearances').select('character_id').eq('book_id', bookId).limit(10000),
  ])
  throwIfError(be)
  throwIfError(ce)
  const ids = [...new Set((apps ?? []).map((a) => a.character_id as string))]
  const { data: chars, error: he } = await supabase
    .from('characters')
    .select('id, full_name, preferred_name, aliases, nicknames, date_of_birth, age, residence')
    .or(`first_appearance_book_id.eq.${bookId}${ids.length ? `,id.in.(${ids.join(',')})` : ''}`)
    .order('full_name')
  throwIfError(he)
  return {
    start: (book?.story_start_date as string | null) ?? null,
    chapters: ((chapters ?? []) as DatedChapter[]).map((c) => ({ ...c, scenes: [...c.scenes].sort((a, b) => a.position - b.position) })),
    characters: (chars ?? []) as BookCharacter[],
  }
}

export async function setBookStartDate(bookId: string, date: string | null) {
  const { error } = await supabase
    .from('books')
    .update({ story_start_date: date || null })
    .eq('id', bookId)
  throwIfError(error)
}

/** Set (or clear) a chapter's story date by hand. Your date always wins over a detected one. */
export async function setChapterDate(chapterId: string, date: string | null) {
  const { error } = await supabase
    .from('chapters')
    .update(
      date
        ? { story_date: date, story_date_text: null, story_date_source: 'author' }
        : { story_date: null, story_date_text: null, story_date_source: null },
    )
    .eq('id', chapterId)
  throwIfError(error)
}

/** Save the dates read from chapter text. Chapters with a date you set are never changed. */
export async function saveDetectedDates(dates: EffectiveDate[]): Promise<number> {
  const found = dates.filter((d) => d.from === 'text' && d.detected)
  for (const d of found) {
    const { error } = await supabase
      .from('chapters')
      .update({ story_date: d.detected!.iso, story_date_text: d.detected!.text.slice(0, 200), story_date_source: 'detected' })
      .eq('id', d.id)
      .is('story_date', null)
    throwIfError(error)
  }
  return found.length
}
