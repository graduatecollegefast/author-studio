// Timeline ordering and labels. No imports, so both the app and server tests can use it.

export interface StoryEvent {
  id: string
  universe_id: string | null
  series_id: string | null
  book_id: string | null
  chapter_id: string | null
  location_element_id: string | null
  title: string
  description: string | null
  event_type: string | null
  date_precision: 'exact' | 'approximate' | 'unknown' | 'relative'
  date_start: string | null
  date_end: string | null
  approximate_label: string | null
  end_label: string | null
  chronological_order: number | null
  reveal_order: number | null
  is_flashback: boolean
  reliability: 'confirmed' | 'uncertain' | 'unreliable_narration'
  notes: string | null
  story_event_characters: Array<{ character_id: string }>
  relationship_events: Array<{ relationship_id: string }>
}

/**
 * Story order: events with exact dates first, by date (then position); then events placed only
 * by their position number; then events with neither. Reveal order follows the order of the
 * books, then each event's reveal position. Both are total orders, so the list never jumps.
 */
export function sortEvents(events: StoryEvent[], mode: 'chronological' | 'reveal', bookOrder: Map<string, number> = new Map()): StoryEvent[] {
  const num = (v: number | null) => (v === null || v === undefined ? Number.POSITIVE_INFINITY : Number(v))
  return [...events].sort((a, b) => {
    if (mode === 'reveal') {
      const ba = bookOrder.get(a.book_id ?? '') ?? Number.POSITIVE_INFINITY
      const bb = bookOrder.get(b.book_id ?? '') ?? Number.POSITIVE_INFINITY
      return ba - bb || num(a.reveal_order) - num(b.reveal_order) || a.title.localeCompare(b.title)
    }
    const tier = (e: StoryEvent) => (e.date_start ? 0 : e.chronological_order !== null && e.chronological_order !== undefined ? 1 : 2)
    const ta = tier(a)
    const tb = tier(b)
    if (ta !== tb) return ta - tb
    if (ta === 0 && a.date_start !== b.date_start) return a.date_start! < b.date_start! ? -1 : 1
    return num(a.chronological_order) - num(b.chronological_order) || a.title.localeCompare(b.title)
  })
}

export function eventDateLabel(e: Pick<StoryEvent, 'date_precision' | 'date_start' | 'date_end' | 'approximate_label' | 'end_label'>): string {
  const start = e.date_precision === 'exact' && e.date_start ? e.date_start : e.approximate_label || (e.date_start ?? '')
  const end = e.date_precision === 'exact' && e.date_end ? e.date_end : e.end_label || (e.date_end ?? '')
  if (!start && !end) return e.date_precision === 'relative' ? 'Relative' : 'Date unknown'
  return end && end !== start ? `${start || '?'} to ${end}` : start
}
