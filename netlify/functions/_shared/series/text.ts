// Pure helpers for the series review: finding characters by name in the text, and picking
// the passages from earlier books that matter for a character or a chapter.

export interface Loc {
  bookId: string
  bookTitle: string
  chapterId: string
  chapterTitle: string
  sceneId: string
  sceneTitle: string
}

export interface Para extends Loc {
  text: string
}

export interface NamedCharacter {
  id: string
  full_name: string
  preferred_name: string | null
  aliases: string[] | null
  nicknames: string[] | null
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every name a character goes by, plus a unique first name, longest first. */
export function nameVariants(c: NamedCharacter, ambiguousFirstNames: Set<string> = new Set()): string[] {
  const names = [c.full_name, c.preferred_name, ...(c.aliases ?? []), ...(c.nicknames ?? [])]
    .map((n) => (n ?? '').trim())
    .filter((n) => n.length >= 3)
  const first = c.full_name.trim().split(/\s+/)[0]
  if (first && first.length >= 3 && first !== c.full_name.trim() && !ambiguousFirstNames.has(first.toLowerCase())) names.push(first)
  return [...new Set(names)].sort((a, b) => b.length - a.length)
}

/** First names shared by two or more characters, which cannot identify anyone on their own. */
export function ambiguousFirstNames(chars: NamedCharacter[]): Set<string> {
  const seen = new Map<string, number>()
  for (const c of chars) {
    const f = c.full_name.trim().split(/\s+/)[0]?.toLowerCase()
    if (f) seen.set(f, (seen.get(f) ?? 0) + 1)
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([f]) => f))
}

/** A whole-word, case-sensitive matcher for any of the names. */
export function nameMatcher(names: string[]): RegExp | null {
  if (!names.length) return null
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
}

export function countMatches(text: string, re: RegExp | null): number {
  if (!re) return 0
  re.lastIndex = 0
  return text.match(re)?.length ?? 0
}

export function paragraphs(text: string, loc: Loc): Para[] {
  return text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter((t) => t && !/^(\*\s*){3}$/.test(t))
    .map((t) => ({ ...loc, text: t }))
}

/** Keep a long paragraph readable: the part around the first match, at most `max` characters. */
export function clip(text: string, re: RegExp | null, max = 900): string {
  if (text.length <= max) return text
  let at = 0
  if (re) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (m) at = m.index
  }
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), text.length - max))
  const sliced = text.slice(start, start + max)
  // Start and end on word boundaries so quotes stay intact.
  const s = start > 0 ? sliced.replace(/^\S*\s/, '') : sliced
  return start + max < text.length ? s.replace(/\s\S*$/, '') : s
}

/** Up to `n` items spread evenly through the list, so early and late appearances both show. */
export function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(items[Math.floor((i * items.length) / n)])
  return out
}

const COMMON = new Set(
  'The A An And But Or If When Then She He It They We You I Her His Their Our My Your This That These Those There Here What Who Why How Where Yes No Not Mr Mrs Ms Dr Oh Well Just So Now Maybe Still Even After Before As At In On Of For To From With Without By Into Over Under Chapter Scene One Two Three God'.split(
    ' ',
  ),
)

/** Capitalized words that look like names or places (not sentence starters or common words). */
export function properNouns(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?<=[^.!?"“\n]\s)([A-Z][a-zÀ-ɏ'’]{2,})/g)) if (!COMMON.has(m[1])) out.add(m[1])
  return out
}

/** Earlier-book paragraphs that share the most names and places with a chapter. */
export function relevantParagraphs(chapterText: string, earlier: Para[], extraNames: string[], n = 14): Para[] {
  const nouns = properNouns(chapterText)
  for (const x of extraNames) if (chapterText.includes(x)) nouns.add(x)
  if (!nouns.size) return []
  const scored = earlier
    .map((p, i) => {
      let score = 0
      for (const w of nouns) if (p.text.includes(w)) score++
      return { p, i, score }
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, n)
  // Back in story order, so the model reads them as they happened.
  return scored.sort((a, b) => a.i - b.i).map((x) => x.p)
}

export const where = (l: Loc, withBook = true) =>
  [withBook ? l.bookTitle : null, l.chapterTitle, l.sceneTitle && l.sceneTitle !== l.chapterTitle ? l.sceneTitle : null].filter(Boolean).join(', ')
