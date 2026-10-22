import { locateExcerpt } from './evidence'
import { RELATIONSHIP_CATEGORIES, STATEMENT_TYPES, WORLD_CATEGORIES, type ExtractionOutput, type SynthesisOutput } from './prompts'

/** Row shape accepted by the save_chunk_discoveries database function. */
export interface DiscoveryRow {
  category: 'character' | 'relationship' | 'world' | 'timeline' | 'plot' | 'theme' | 'style' | 'series'
  entity_type: 'character' | 'relationship' | 'world_element' | 'story_event' | 'book'
  entity_label: string
  attribute: string
  value: string
  statement_type: string
  confidence: number
  excerpt: string | null
  char_start: number | null
  char_end: number | null
  payload: Record<string, unknown>
}

const MAX_PER_CHUNK = 60
const clean = (s: unknown, max = 500) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const attr = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_. ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60)

function statement(t: unknown): string {
  const s = typeof t === 'string' ? t : ''
  // Only the author can confirm canon; a model claiming it is downgraded to narration.
  if (s === 'author_confirmed') return 'narrator'
  return (STATEMENT_TYPES as readonly string[]).includes(s) ? s : 'ai_inference'
}

function confidence(n: unknown, type: string): number {
  let c = typeof n === 'number' && Number.isFinite(n) ? n : 0.5
  if (c > 1 && c <= 100) c = c / 100
  c = Math.min(1, Math.max(0, c))
  // Hearsay and dreams are never "high confidence" canon, whatever the model says.
  if (['rumor', 'dream', 'character_belief'].includes(type)) c = Math.min(c, 0.6)
  return Math.round(c * 100) / 100
}

export interface ChunkRef {
  content: string
  charStart: number
}

/**
 * Turn one passage's model output into reviewable discoveries. Items without a verifiable
 * verbatim excerpt are dropped and counted, so no invented evidence reaches the author.
 */
export function chunkDiscoveries(out: ExtractionOutput, chunk: ChunkRef): { rows: DiscoveryRow[]; unverified: number } {
  const rows: DiscoveryRow[] = []
  let unverified = 0
  for (const f of Array.isArray(out?.facts) ? out.facts : []) {
    if (rows.length >= MAX_PER_CHUNK) break
    const subject = clean(f.subject, 200)
    const value = clean(f.value, 2000)
    if (!subject || !value) continue
    const at = locateExcerpt(chunk.content, String(f.excerpt ?? ''))
    if (!at) {
      unverified++
      continue
    }
    const type = statement(f.statement_type)
    const base = {
      statement_type: type,
      confidence: confidence(f.confidence, type),
      excerpt: chunk.content.slice(at.start, at.end),
      char_start: chunk.charStart + at.start,
      char_end: chunk.charStart + at.end,
    }
    if (f.category === 'character') {
      rows.push({ ...base, category: 'character', entity_type: 'character', entity_label: subject, attribute: attr(f.attribute) || 'detail', value, payload: {} })
    } else if (f.category === 'relationship') {
      const other = clean(f.related_name, 200)
      if (!other || other.toLowerCase() === subject.toLowerCase()) continue
      const cat = (RELATIONSHIP_CATEGORIES as readonly string[]).includes(f.relationship_category) ? f.relationship_category : 'custom'
      rows.push({
        ...base,
        category: 'relationship',
        entity_type: 'relationship',
        entity_label: subject,
        attribute: clean(f.attribute, 100) || cat,
        value,
        payload: { related_name: other, relationship_category: cat },
      })
    } else if (f.category === 'world') {
      const wc = (WORLD_CATEGORIES as readonly string[]).includes(f.world_category) ? f.world_category : 'other'
      const a = attr(f.attribute)
      rows.push({
        ...base,
        category: 'world',
        entity_type: 'world_element',
        entity_label: subject,
        attribute: ['description', 'rule', 'history', 'detail'].includes(a) ? a : 'detail',
        value,
        payload: { world_category: wc },
      })
    } else if (f.category === 'timeline') {
      rows.push({
        ...base,
        category: 'timeline',
        entity_type: 'story_event',
        entity_label: subject,
        attribute: 'event',
        value,
        statement_type: f.is_flashback && type === 'narrator' ? 'flashback' : type,
        payload: {
          when: clean(f.when, 200),
          is_flashback: Boolean(f.is_flashback),
          characters: (Array.isArray(f.characters_involved) ? f.characters_involved : []).map((c) => clean(c, 200)).filter(Boolean).slice(0, 20),
        },
      })
    }
  }
  return { rows, unverified }
}

/** Whole-book findings. They come from passage summaries, so they are labeled AI inference or suggestion. */
export function synthesisDiscoveries(out: SynthesisOutput, bookTitle: string): DiscoveryRow[] {
  const rows: DiscoveryRow[] = []
  const add = (category: DiscoveryRow['category'], attribute: string, value: unknown, type = 'ai_inference', payload: Record<string, unknown> = {}) => {
    const v = clean(value, 2000)
    if (!v) return
    rows.push({ category, entity_type: 'book', entity_label: bookTitle, attribute, value: v, statement_type: type, confidence: 0.7, excerpt: null, char_start: null, char_end: null, payload })
  }
  const p = out?.plot
  if (p) {
    add('plot', 'primary_plot', p.primary)
    for (const s of p.subplots ?? []) add('plot', 'subplot', s)
    for (const s of p.conflicts ?? []) add('plot', 'conflict', s)
    for (const s of p.turning_points ?? []) add('plot', 'turning_point', s)
    add('plot', 'climax', p.climax)
    add('plot', 'ending', p.ending)
    for (const s of p.unresolved ?? []) add('plot', 'unresolved_conflict', s)
  }
  for (const s of out?.themes ?? []) add('theme', 'theme', s)
  for (const s of out?.emotional_conflicts ?? []) add('theme', 'emotional_conflict', s)
  for (const s of out?.central_questions ?? []) add('theme', 'central_question', s)
  for (const [k, v] of Object.entries(out?.style ?? {})) add('style', k, v)
  for (const s of out?.series_opportunities ?? []) add('series', clean(s.kind, 40) || 'other', s.idea, 'ai_suggestion')
  return rows
}
