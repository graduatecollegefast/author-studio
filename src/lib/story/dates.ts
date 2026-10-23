// Story dates and character ages. No imports, so the app, the server and tests share it.
// Dates are read from the text only when written out plainly ("March 3, 2024", "3rd of
// March 2024", "2024-03-03", "3/3/2024", "March 2024", or "March 3" in a year already known).

export type Precision = 'day' | 'month' | 'year'

export interface FoundDate {
  index: number
  end: number
  text: string
  iso: string
  precision: Precision
  /** The year came from an earlier chapter, not from these words. */
  yearInferred?: boolean
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_RE =
  '(January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sept?\\.?|Oct\\.?|Nov\\.?|Dec\\.?)'
const DAY_RE = '(\\d{1,2})(?:st|nd|rd|th)?'
const YEAR_RE = '(1[0-9]{3}|2[0-9]{3})'

const monthIndex = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().replace('.', '').slice(0, 3)))
const pad = (n: number) => String(n).padStart(2, '0')

function valid(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Every plainly written date in the text, in order of appearance. */
export function detectDates(text: string, opts: { defaultYear?: number | null } = {}): FoundDate[] {
  const found: FoundDate[] = []
  const taken: Array<[number, number]> = []
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x)
  const add = (m: RegExpExecArray, y: number, mo: number, d: number | null, extra: Partial<FoundDate> = {}) => {
    const end = m.index + m[0].length
    if (!free(m.index, end)) return
    if (d !== null && !valid(y, mo, d)) return
    if (mo < 1 || mo > 12) return
    taken.push([m.index, end])
    found.push({ index: m.index, end, text: m[0].trim(), iso: `${y}-${pad(mo)}-${pad(d ?? 1)}`, precision: d === null ? 'month' : 'day', ...extra })
  }
  const scan = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    for (let m = re.exec(text); m; m = re.exec(text)) fn(m)
  }
  // Most specific patterns first, so "March 3, 2024" is not also read as "March 2024".
  scan(new RegExp(`\\b${MONTH_RE} ${DAY_RE},? ${YEAR_RE}\\b`, 'g'), (m) => add(m, +m[3], monthIndex(m[1]) + 1, +m[2]))
  scan(new RegExp(`\\b${DAY_RE} (?:of )?${MONTH_RE},? ${YEAR_RE}\\b`, 'g'), (m) => add(m, +m[3], monthIndex(m[2]) + 1, +m[1]))
  scan(/\b(1[0-9]{3}|2[0-9]{3})-(\d{2})-(\d{2})\b/g, (m) => add(m, +m[1], +m[2], +m[3]))
  scan(/\b(\d{1,2})\/(\d{1,2})\/(1[0-9]{3}|2[0-9]{3})\b/g, (m) => add(m, +m[3], +m[1], +m[2]))
  scan(new RegExp(`\\b${MONTH_RE},? (?:of )?${YEAR_RE}\\b`, 'g'), (m) => add(m, +m[2], monthIndex(m[1]) + 1, null))
  if (opts.defaultYear) {
    const y = opts.defaultYear
    scan(new RegExp(`\\b${MONTH_RE} ${DAY_RE}\\b(?!,? ?\\d)`, 'g'), (m) => add(m, y, monthIndex(m[1]) + 1, +m[2], { yearInferred: true }))
    scan(new RegExp(`\\b(?:the )?${DAY_RE} of ${MONTH_RE}\\b(?!,? ?\\d)`, 'g'), (m) => add(m, y, monthIndex(m[2]) + 1, +m[1], { yearInferred: true }))
  }
  return found.sort((a, b) => a.index - b.index)
}

/** The date a chapter happens on: the first date written in it. */
export function chapterDate(text: string, defaultYear?: number | null): FoundDate | null {
  return detectDates(text, { defaultYear }).find((d) => d.precision === 'day' || d.precision === 'month') ?? null
}

export interface ChapterDateInput {
  id: string
  title: string
  story_date: string | null
  story_date_text?: string | null
  story_date_source?: 'detected' | 'author' | null
}

export interface ResolvedDate {
  id: string
  title: string
  date: string | null
  /** Where the date comes from: this chapter, an earlier chapter, or the book's start date. */
  from: 'chapter' | 'earlier' | 'book' | null
  fromTitle?: string
}

/** Each chapter's story date; a chapter without one carries the date of the chapter before it. */
export function resolveDates(chapters: ChapterDateInput[], bookStart: string | null): ResolvedDate[] {
  let last: { date: string; from: ResolvedDate['from']; title?: string } | null = bookStart ? { date: bookStart, from: 'book' } : null
  return chapters.map((c) => {
    if (c.story_date) {
      last = { date: c.story_date, from: 'chapter', title: c.title }
      return { id: c.id, title: c.title, date: c.story_date, from: 'chapter' }
    }
    if (!last) return { id: c.id, title: c.title, date: null, from: null }
    return { id: c.id, title: c.title, date: last.date, from: last.from === 'book' ? 'book' : 'earlier', fromTitle: last.title }
  })
}

// ---------------------------------------------------------------------------
// Birth dates and ages
// ---------------------------------------------------------------------------
export interface Birth {
  iso: string
  precision: Precision
}

/** Read a birth date written any common way; a year alone is accepted. */
export function parseBirth(text: string | null | undefined): Birth | null {
  const t = (text ?? '').trim()
  if (!t) return null
  const d = detectDates(t)[0]
  if (d) return { iso: d.iso, precision: d.precision }
  const y = /\b(1[0-9]{3}|2[0-9]{3})\b/.exec(t)
  return y ? { iso: `${y[1]}-01-01`, precision: 'year' } : null
}

/** Age on a date. With only a birth year (or month), the age can be one of two numbers. */
export function ageOn(birth: Birth, dateIso: string): { min: number; max: number } | null {
  const [by, bm, bd] = birth.iso.split('-').map(Number)
  const [y, m, d] = dateIso.split('-').map(Number)
  if (!by || !y) return null
  let age = y - by
  if (birth.precision === 'year') return age - 1 < 0 ? null : { min: Math.max(0, age - 1), max: age }
  if (birth.precision === 'month') {
    if (m < bm) age -= 1
    if (m === bm) return age - 1 < 0 ? null : { min: age - 1, max: age }
    return age < 0 ? null : { min: age, max: age }
  }
  if (m < bm || (m === bm && d < bd)) age -= 1
  return age < 0 ? null : { min: age, max: age }
}

export const ageLabel = (a: { min: number; max: number }) => (a.min === a.max ? String(a.min) : `${a.min} or ${a.max}`)

export function formatStoryDate(iso: string | null | undefined, precision: Precision = 'day'): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const month = MONTHS[m - 1] ? MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1) : ''
  if (precision === 'year') return String(y)
  if (precision === 'month') return `${month} ${y}`
  return `${month} ${d}, ${y}`
}

// ---------------------------------------------------------------------------
// Ages stated in the text
// ---------------------------------------------------------------------------
const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** "34", "thirty-four", "thirty four" or "a hundred" as a number. */
export function numberWord(s: string): number | null {
  const t = s.toLowerCase().trim().replace(/\s+/g, '-')
  if (/^\d{1,3}$/.test(t)) return +t
  if (t === 'a-hundred' || t === 'one-hundred' || t === 'hundred') return 100
  const one = ONES.indexOf(t)
  if (one >= 0) return one
  const [a, b] = t.split('-')
  const ten = TENS.indexOf(a)
  if (ten >= 2) {
    if (!b) return ten * 10
    const u = ONES.indexOf(b)
    if (u > 0 && u < 10) return ten * 10 + u
  }
  return null
}

const NUM =
  '(\\d{1,3}|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)'

export interface AgeMention {
  index: number
  end: number
  text: string
  age: number
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Places where the narration gives a named character's age. */
export function findAgeMentions(text: string, names: string[]): AgeMention[] {
  if (!names.length) return []
  const N = `(?:${names.map(esc).join('|')})(?:['’]s)?`
  const patterns = [
    // "Mara, 34," / "Mara (34)"
    new RegExp(`\\b${N}[,(] ?${NUM}[,)]`, 'giu'),
    // "Mara was thirty-four years old" / "Mara is 34." / "Mara had just turned 35"
    new RegExp(
      `\\b${N} (?:was|is|had just turned|has just turned|just turned|turned|is now|was now|would be|will be|turns|was turning|is turning)(?: only| barely| nearly| almost)? ${NUM}(?:(?: years?)? old\\b|-year-old\\b|(?=[.,;!?]))`,
      'giu',
    ),
    // "34-year-old Mara" / "the thirty-four-year-old Mara"
    new RegExp(`\\b${NUM}[- ]years?[- ]old ${N}`, 'giu'),
    // "Mara's 35th birthday"
    new RegExp(`\\b${N} (?:celebrated (?:her|his|their) |)(\\d{1,3})(?:st|nd|rd|th) birthday`, 'giu'),
  ]
  const out: AgeMention[] = []
  for (const re of patterns) {
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const n = numberWord(m[1])
      if (n === null || n > 130) continue
      if (out.some((o) => m!.index < o.end && m!.index + m![0].length > o.index)) continue
      out.push({ index: m.index, end: m.index + m[0].length, text: m[0], age: n })
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

// ---------------------------------------------------------------------------
// The check: ages in the text and in profiles against birth dates and story dates
// ---------------------------------------------------------------------------
export interface AgeCheckChapter {
  id: string
  title: string
  date: string | null
  dateNote: string
  scenes: Array<{ id: string; title: string; text: string }>
}

export interface AgeCheckCharacter {
  id: string
  name: string
  names: string[]
  dateOfBirth: string | null
  age: string | null
}

export interface AgeIssue {
  characterId: string
  chapterId: string | null
  sceneId: string | null
  severity: 'warning' | 'suggestion'
  description: string
  established: string
  establishedWhere: string
  conflicting: string
  conflictingWhere: string
  fix: string
}

export function checkAges(chapters: AgeCheckChapter[], characters: AgeCheckCharacter[], bookStart: string | null): AgeIssue[] {
  const issues: AgeIssue[] = []
  const firstDate = bookStart ?? chapters.find((c) => c.date)?.date ?? null
  for (const c of characters) {
    const birth = parseBirth(c.dateOfBirth)
    const born = birth ? `Born ${formatStoryDate(birth.iso, birth.precision)}` : ''
    // The profile age against the age at the start of the book.
    const profileAge = numberWord(String(c.age ?? '').replace(/\s*(years?|yrs?)\.?(\s*old)?$/i, ''))
    if (birth && firstDate && profileAge !== null) {
      const expected = ageOn(birth, firstDate)
      if (expected && (profileAge < expected.min || profileAge > expected.max))
        issues.push({
          characterId: c.id,
          chapterId: null,
          sceneId: null,
          severity: 'suggestion',
          description: `${c.name}'s profile says age ${profileAge}, but born ${formatStoryDate(birth.iso, birth.precision)} makes them ${ageLabel(expected)} when this book begins (${formatStoryDate(firstDate)}).`,
          established: `${born}; book begins ${formatStoryDate(firstDate)}`,
          establishedWhere: 'Character Bible',
          conflicting: `Age: ${c.age}`,
          conflictingWhere: 'Character Bible',
          fix: `Change the profile age to ${ageLabel(expected)}, correct the birth date, or set the date this book begins on its Story dates tab.`,
        })
    }
    if (!birth) continue
    for (const ch of chapters) {
      if (!ch.date) continue
      const expected = ageOn(birth, ch.date)
      if (!expected) continue
      for (const s of ch.scenes) {
        for (const m of findAgeMentions(s.text, c.names)) {
          if (m.age >= expected.min && m.age <= expected.max) continue
          issues.push({
            characterId: c.id,
            chapterId: ch.id,
            sceneId: s.id,
            severity: 'warning',
            description: `${c.name} is given as ${m.age} here, but born ${formatStoryDate(birth.iso, birth.precision)} makes them ${ageLabel(expected)} on ${formatStoryDate(ch.date)}.`,
            established: `${born} (Character Bible); this chapter takes place ${formatStoryDate(ch.date)}${ch.dateNote ? ` (${ch.dateNote})` : ''}`,
            establishedWhere: 'Character Bible and story dates',
            conflicting: m.text,
            conflictingWhere: [ch.title, s.title !== ch.title ? s.title : null].filter(Boolean).join(', '),
            fix: `Change the age to ${ageLabel(expected)}, correct the birth date, or correct this chapter's story date.`,
          })
        }
      }
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// Chapter dates for a whole book: saved dates first, then dates read from the text,
// then the date carried from the chapter before (or the book's start date).
// ---------------------------------------------------------------------------
export interface ChapterWithText extends ChapterDateInput {
  text: string
}

export interface EffectiveDate {
  id: string
  title: string
  date: string | null
  /** author: set by the author; saved: detected earlier and saved; text: read from this chapter now; earlier/book: carried forward. */
  from: 'author' | 'saved' | 'text' | 'earlier' | 'book' | null
  /** The words the date was read from, or where it was carried from. */
  note: string
  detected: FoundDate | null
}

export function effectiveDates(chapters: ChapterWithText[], bookStart: string | null): EffectiveDate[] {
  let last: { date: string; note: string; from: 'earlier' | 'book' } | null = bookStart
    ? { date: bookStart, note: 'when the book begins', from: 'book' }
    : null
  return chapters.map((c) => {
    const year = last ? Number(last.date.slice(0, 4)) : null
    const detected = chapterDate(c.text, year)
    let out: EffectiveDate
    if (c.story_date) {
      out = {
        id: c.id,
        title: c.title,
        date: c.story_date,
        from: c.story_date_source === 'author' ? 'author' : 'saved',
        note: c.story_date_source === 'author' ? 'set by you' : c.story_date_text ? `"${c.story_date_text}"` : 'detected',
        detected,
      }
    } else if (detected) {
      out = { id: c.id, title: c.title, date: detected.iso, from: 'text', note: `"${detected.text}"`, detected }
    } else if (last) {
      out = { id: c.id, title: c.title, date: last.date, from: last.from, note: last.note, detected: null }
    } else {
      out = { id: c.id, title: c.title, date: null, from: null, note: '', detected: null }
    }
    if (out.date && out.from !== 'earlier' && out.from !== 'book') last = { date: out.date, note: `carried from ${c.title}`, from: 'earlier' }
    return out
  })
}
