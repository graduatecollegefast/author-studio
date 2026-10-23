import { describe, expect, it } from 'vitest'
import {
  ambiguousFirstNames,
  clip,
  countMatches,
  nameMatcher,
  nameVariants,
  properNouns,
  relevantParagraphs,
  spread,
  type Para,
} from '../../netlify/functions/_shared/series/text'
import { verifySeries } from '../../netlify/functions/_shared/series/review'
import { SERIES_SCHEMA } from '../../netlify/functions/_shared/series/prompts'

const loc = (book: string, chapter: string) => ({
  bookId: book,
  bookTitle: book,
  chapterId: `${book}-${chapter}`,
  chapterTitle: chapter,
  sceneId: `${book}-${chapter}-s`,
  sceneTitle: chapter,
})
const para = (book: string, chapter: string, text: string): Para => ({ ...loc(book, chapter), text })

describe('finding characters by name', () => {
  const mara = { id: '1', full_name: 'Mara Vance', preferred_name: null, aliases: ['The Keeper'], nicknames: ['Mare'] }
  const mark = { id: '2', full_name: 'Mara Lowe', preferred_name: null, aliases: [], nicknames: [] }
  it('uses every name, and a first name only when no one else shares it', () => {
    expect(nameVariants(mara)).toEqual(['Mara Vance', 'The Keeper', 'Mare', 'Mara'])
    expect(nameVariants(mara, ambiguousFirstNames([mara, mark]))).toEqual(['Mara Vance', 'The Keeper', 'Mare'])
  })
  it('matches whole words with the right case only', () => {
    const re = nameMatcher(['Mara', 'Mare'])
    expect(countMatches('Mara ran. Mare laughed. Marathon. mara. Mara’s coat.', re)).toBe(3)
    expect(countMatches('nothing', null)).toBe(0)
  })
  it('clips long paragraphs around the name on word boundaries', () => {
    const long = 'word '.repeat(400) + 'Mara stood up. ' + 'tail '.repeat(400)
    const c = clip(long, nameMatcher(['Mara']), 300)
    expect(c.length).toBeLessThanOrEqual(300)
    expect(c).toContain('Mara stood up.')
    expect(c.startsWith('word')).toBe(true)
  })
  it('spreads picks across early and late appearances', () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)).toEqual([1, 4, 7])
  })
})

describe('earlier passages for a chapter', () => {
  it('ranks earlier paragraphs by shared names and places, in story order', () => {
    expect([...properNouns('She walked to Harbor Street with Eli. The lamp lit Portsmouth.')]).toEqual(
      expect.arrayContaining(['Harbor', 'Street', 'Eli', 'Portsmouth']),
    )
    const earlier = [
      para('B1', 'One', 'Nothing about anyone here at all.'),
      para('B1', 'Two', 'Eli lived on Harbor Street in Portsmouth for years.'),
      para('B1', 'Three', 'Eli and Mara met in Portsmouth.'),
    ]
    const got = relevantParagraphs('Later, Eli drove to Portsmouth and then to Harbor Street.', earlier, ['Mara'])
    expect(got.map((p) => p.chapterTitle)).toEqual(['Two', 'Three'])
  })
})

describe('series review findings', () => {
  const earlier = [para('Book One', 'Chapter 3', 'Mara had green eyes like the sea in winter.')]
  const current = [para('Book Two', 'Chapter 1', 'Mara blinked her brown eyes against the wind.')]
  const fact = {
    id: 'f1',
    book_id: 'b1',
    entity_id: 'c1',
    attribute: 'birthday',
    value: 'March 3',
    fact_sources: [{ excerpt: 'born on the third of March', location_label: 'Chapter 2' }],
  }
  const step = { kind: 'character' as const, key: 'char:c1', name: 'Mara Vance', input: '', earlier, current, facts: [fact] }

  it('keeps only findings quoted word for word from both books', () => {
    const out = verifySeries(
      {
        findings: [
          {
            category: 'appearance',
            severity: 'warning',
            earlier_ref: 'P1',
            earlier_excerpt: 'Mara had green eyes like the sea',
            current_excerpt: 'Mara blinked her brown eyes',
            description: 'Eye color changed.',
            suggested_resolution: 'Pick one.',
          },
          {
            category: 'birthday',
            severity: 'bogus',
            earlier_ref: '[F1]',
            earlier_excerpt: 'March 3',
            current_excerpt: 'blinked her brown eyes against the wind',
            description: 'Birthday.',
            suggested_resolution: 'x',
          },
          {
            category: 'age',
            severity: 'critical',
            earlier_ref: 'P1',
            earlier_excerpt: 'Mara had green eyes like the sea',
            current_excerpt: 'This sentence is not in book two.',
            description: 'x',
            suggested_resolution: 'x',
          },
          {
            category: 'age',
            severity: 'critical',
            earlier_ref: 'P9',
            earlier_excerpt: 'Mara had green eyes like the sea',
            current_excerpt: 'Mara blinked her brown eyes',
            description: 'x',
            suggested_resolution: 'x',
          },
          {
            category: 'nonsense',
            severity: 'warning',
            earlier_ref: 'P1',
            earlier_excerpt: 'invented earlier words here',
            current_excerpt: 'Mara blinked her brown eyes',
            description: 'x',
            suggested_resolution: 'x',
          },
        ],
      },
      step,
      'Mara Vance',
    )
    expect(out.unverified).toBe(3)
    expect(out.findings).toHaveLength(2)
    expect(out.findings[0]).toMatchObject({
      category: 'appearance',
      original_evidence: 'Mara had green eyes like the sea',
      original_location: 'Book One, Chapter 3',
      conflicting_evidence: 'Mara blinked her brown eyes',
      conflicting_location: 'Chapter 1',
      chapter_id: 'Book Two-Chapter 1',
      description: 'Mara Vance: Eye color changed.',
    })
    expect(out.findings[1]).toMatchObject({
      category: 'birthday',
      severity: 'suggestion',
      canon_fact_ids: ['f1'],
      description: 'Mara Vance: Birthday.',
    })
  })

  it('checks chapter quotes against the chapter and finds their scene', () => {
    const text = 'First scene text here.\n\nMara blinked her brown eyes against the wind.'
    const chapter = {
      id: 'ch',
      title: 'One',
      text,
      spans: [
        { loc: { ...loc('Book Two', 'One'), sceneId: 's1' }, start: 0, end: 22 },
        { loc: { ...loc('Book Two', 'One'), sceneId: 's2', sceneTitle: 'Wind' }, start: 24, end: text.length },
      ],
    }
    const out = verifySeries(
      {
        findings: [
          {
            category: 'appearance',
            severity: 'warning',
            earlier_ref: 'P1',
            earlier_excerpt: 'green eyes like the sea in winter',
            current_excerpt: 'her brown eyes against the wind',
            description: 'd',
            suggested_resolution: 'r',
          },
        ],
      },
      { kind: 'chapter', key: 'chap:ch', name: 'One', input: '', earlier, chapter },
    )
    expect(out.findings[0]).toMatchObject({ scene_id: 's2', conflicting_location: 'One, Wind' })
  })

  it('asks for both quotes in the schema', () => {
    expect(SERIES_SCHEMA.properties.findings.items.required).toEqual(expect.arrayContaining(['earlier_ref', 'earlier_excerpt', 'current_excerpt']))
  })
})
