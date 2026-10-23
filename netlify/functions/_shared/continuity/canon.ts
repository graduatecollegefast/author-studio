// Pure helpers for the continuity checker: free canon-vs-canon checks, and choosing the
// approved canon that matters for one chapter (so prompts stay small and cheap).

export interface CanonFactRow {
  id: string
  book_id: string | null
  entity_type: string
  entity_id: string | null
  entity_label: string | null
  attribute: string
  value: string
  statement_type: string
  payload: Record<string, unknown>
  fact_sources: Array<{ excerpt: string | null; location_label: string | null; book_id: string | null }>
}

export interface CharacterRow {
  id: string
  full_name: string
  preferred_name: string | null
  aliases: string[]
  nicknames: string[]
}

export interface FindingDraft {
  category: string
  severity: 'critical' | 'warning' | 'suggestion'
  description: string
  original_evidence: string
  original_location: string
  conflicting_evidence: string
  conflicting_location: string
  suggested_resolution: string
  canon_fact_ids: string[]
}

/** Details that should not change for a character, in any book. */
const STABLE: Record<string, { category: string; label: string }> = {
  date_of_birth: { category: 'birthday', label: 'birthday' },
  'appearance.eyes': { category: 'appearance', label: 'eye color' },
  'appearance.skin_tone': { category: 'appearance', label: 'skin tone' },
  'appearance.height': { category: 'appearance', label: 'height' },
}

const STOP = new Set(['a', 'an', 'the', 'and', 'of', 'eyes', 'eye', 'colored', 'color', 'colour', 'skin', 'tall', 'is', 'was', 'her', 'his', 'their'])
export function normalizeValue(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .sort()
    .join(' ')
}

const quote = (f: CanonFactRow) => f.fact_sources.find((s) => s.excerpt)?.excerpt ?? null
const place = (f: CanonFactRow, titles: Map<string, string>) => {
  const s = f.fact_sources[0]
  const book = f.book_id ? titles.get(f.book_id) : undefined
  return [book, s?.location_label].filter(Boolean).join(', ') || 'Story Bible'
}
const evidence = (f: CanonFactRow) => (quote(f) ? `${f.value}: "${quote(f)}"` : f.value)

/**
 * Approved canon that disagrees with itself: a stable detail (birthday, eye color, skin tone,
 * height) recorded with different values, or an age recorded twice in the same book.
 * Only conflicts touching `bookIds` are reported. Costs nothing: no AI involved.
 */
export function canonConflicts(facts: CanonFactRow[], bookIds: Set<string>, titles: Map<string, string>): FindingDraft[] {
  const groups = new Map<string, CanonFactRow[]>()
  for (const f of facts) {
    if (f.entity_type !== 'character') continue
    if (['rumor', 'dream', 'character_belief', 'character_statement', 'ai_suggestion'].includes(f.statement_type)) continue
    const who = f.entity_id ?? (f.entity_label ?? '').toLowerCase()
    const stable = STABLE[f.attribute]
    const key = stable ? `${who}|${f.attribute}` : f.attribute === 'age' ? `${who}|age|${f.book_id}` : null
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  const out: FindingDraft[] = []
  for (const [key, rows] of groups) {
    const distinct = new Map<string, CanonFactRow>()
    for (const r of rows) {
      const n = normalizeValue(r.value)
      if (n && !distinct.has(n)) distinct.set(n, r)
    }
    if (distinct.size < 2) continue
    const [a, b] = [...distinct.values()]
    if (!bookIds.has(a.book_id ?? '') && !bookIds.has(b.book_id ?? '')) continue
    const name = a.entity_label ?? 'A character'
    const isAge = key.includes('|age|')
    const label = isAge ? 'age' : STABLE[a.attribute].label
    out.push({
      category: isAge ? 'age' : STABLE[a.attribute].category,
      severity: isAge ? 'suggestion' : 'warning',
      description: isAge
        ? `${name}'s age is recorded as "${a.value}" and "${b.value}" in the same book. If time passes in the story this may be intended.`
        : `${name}'s ${label} is recorded as "${a.value}" and as "${b.value}".`,
      original_evidence: evidence(a),
      original_location: place(a, titles),
      conflicting_evidence: evidence(b),
      conflicting_location: place(b, titles),
      suggested_resolution: isAge
        ? 'Check whether time passes between these scenes. If not, change one age in the manuscript, or mark this intentional.'
        : `Decide which ${label} is correct, then edit the scene that uses the other one, or reject the incorrect fact in the Story Bible.`,
      canon_fact_ids: [a.id, b.id],
    })
  }
  return out
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Names a character goes by. First names count only when no other character shares them. */
export function characterNames(chars: CharacterRow[]): Map<string, string[]> {
  const firstCount = new Map<string, number>()
  for (const c of chars) {
    const first = c.full_name.split(/\s+/)[0]
    firstCount.set(first, (firstCount.get(first) ?? 0) + 1)
  }
  const out = new Map<string, string[]>()
  for (const c of chars) {
    const first = c.full_name.split(/\s+/)[0]
    const names = [c.full_name, c.preferred_name ?? '', ...c.aliases, ...c.nicknames]
    if (first.length >= 3 && firstCount.get(first) === 1) names.push(first)
    out.set(c.id, [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))])
  }
  return out
}

export function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${escapeRe(name)}(?=$|[^\\p{L}])`, 'u').test(text)
}

export interface ContextFact {
  ref: string
  fact: CanonFactRow
  line: string
}

/** The approved canon one chapter could contradict: facts about the characters, places and events it mentions. */
export function chapterContext(
  text: string,
  facts: CanonFactRow[],
  chars: CharacterRow[],
  titles: Map<string, string>,
  currentBookId: string | null = null,
  max = 120,
): ContextFact[] {
  const names = characterNames(chars)
  const present = new Set<string>()
  const presentLabels = new Set<string>()
  for (const c of chars) {
    if ((names.get(c.id) ?? []).some((n) => mentions(text, n))) {
      present.add(c.id)
      for (const n of names.get(c.id) ?? []) presentLabels.add(n.toLowerCase())
    }
  }
  const lower = text.toLowerCase()
  const picked: CanonFactRow[] = []
  for (const f of facts) {
    const label = (f.entity_label ?? '').toLowerCase()
    let relevant = false
    if (f.entity_type === 'character') relevant = (f.entity_id !== null && present.has(f.entity_id)) || presentLabels.has(label)
    else if (f.entity_type === 'relationship')
      relevant = presentLabels.has(label) || presentLabels.has(String(f.payload?.related_name ?? '').toLowerCase())
    else if (f.entity_type === 'world_element') relevant = label.length >= 3 && lower.includes(label)
    else if (f.entity_type === 'story_event') {
      const who = Array.isArray(f.payload?.characters) ? (f.payload.characters as string[]) : []
      relevant = who.some((n) => presentLabels.has(n.toLowerCase()))
    }
    if (relevant) picked.push(f)
  }
  // Facts from other books first: those are the contradictions an author is least likely to catch.
  picked.sort((a, b) => Number(a.book_id === currentBookId) - Number(b.book_id === currentBookId))
  return picked.slice(0, max).map((f, i) => {
    const ref = `F${i + 1}`
    const where = [f.book_id ? titles.get(f.book_id) : null, f.fact_sources[0]?.location_label].filter(Boolean).join(', ')
    const rel = f.entity_type === 'relationship' && f.payload?.related_name ? ` (with ${String(f.payload.related_name)})` : ''
    const line = `[${ref}] ${f.entity_label ?? ''}${rel} | ${f.attribute.replace(/_/g, ' ')}: ${f.value} (${f.statement_type.replace(/_/g, ' ')}${where ? `; ${where}` : ''})`
    return { ref, fact: f, line: line.replace(/<\/?manuscript>/gi, '') }
  })
}
