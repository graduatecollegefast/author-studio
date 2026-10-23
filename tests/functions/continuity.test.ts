import { describe, expect, it } from 'vitest'
import { canonConflicts, chapterContext, characterNames, mentions, normalizeValue, type CanonFactRow } from '../../netlify/functions/_shared/continuity/canon'
import { verifyFindings } from '../../netlify/functions/_shared/continuity/job'
import { CONTINUITY_SCHEMA, continuityInput } from '../../netlify/functions/_shared/continuity/prompts'
import { eventDateLabel, sortEvents, type StoryEvent } from '../../src/lib/story/timeline'

const fact = (o: Partial<CanonFactRow>): CanonFactRow => ({
  id: 'f',
  book_id: 'b1',
  entity_type: 'character',
  entity_id: 'mara',
  entity_label: 'Mara Vance',
  attribute: 'occupation',
  value: 'lighthouse keeper',
  statement_type: 'narrator',
  payload: {},
  fact_sources: [{ excerpt: 'Mara Vance worked as a lighthouse keeper.', location_label: 'Chapter 1', book_id: 'b1' }],
  ...o,
})
const titles = new Map([
  ['b1', 'Salt Letters'],
  ['b2', 'Salt Letters 2'],
])
const chars = [
  { id: 'mara', full_name: 'Mara Vance', preferred_name: null, aliases: ['The Keeper'], nicknames: [] },
  { id: 'eli', full_name: 'Eli Vance', preferred_name: null, aliases: [], nicknames: [] },
  { id: 'eli2', full_name: 'Eli Stone', preferred_name: null, aliases: [], nicknames: [] },
]

describe('canon conflicts (free check)', () => {
  it('flags a stable detail recorded two ways, ignoring wording', () => {
    const out = canonConflicts(
      [
        fact({ id: 'a', attribute: 'appearance.eyes', value: 'Green eyes' }),
        fact({ id: 'a2', attribute: 'appearance.eyes', value: 'green' }),
        fact({ id: 'b', book_id: 'b2', attribute: 'appearance.eyes', value: 'brown' }),
      ],
      new Set(['b2']),
      titles,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ category: 'appearance', severity: 'warning', canon_fact_ids: ['a', 'b'] })
    expect(out[0].description).toContain("Mara Vance's eye color")
    expect(out[0].original_location).toBe('Salt Letters, Chapter 1')
  })
  it('allows changes over time and ignores rumors and other books', () => {
    const facts = [
      fact({ id: 'a', value: 'lighthouse keeper' }),
      fact({ id: 'b', book_id: 'b2', value: 'harbor master' }),
      fact({ id: 'c', attribute: 'date_of_birth', value: 'May 1' }),
      fact({ id: 'd', attribute: 'date_of_birth', value: 'June 9', statement_type: 'rumor' }),
      fact({ id: 'e', attribute: 'age', value: '30' }),
      fact({ id: 'f2', attribute: 'age', value: '35', book_id: 'b2' }),
    ]
    expect(canonConflicts(facts, new Set(['b1', 'b2']), titles)).toEqual([])
    expect(canonConflicts([fact({ id: 'x', attribute: 'appearance.eyes', value: 'green' }), fact({ id: 'y', attribute: 'appearance.eyes', value: 'grey' })], new Set(['b9']), titles)).toEqual([])
  })
  it('flags two ages in the same book as a gentle suggestion', () => {
    const out = canonConflicts([fact({ id: 'a', attribute: 'age', value: '30' }), fact({ id: 'b', attribute: 'age', value: '41' })], new Set(['b1']), titles)
    expect(out[0]).toMatchObject({ category: 'age', severity: 'suggestion' })
  })
  it('normalizes values', () => {
    expect(normalizeValue('The Green, eyes')).toBe(normalizeValue('green'))
  })
})

describe('chapter context', () => {
  it('matches full names, aliases and unique first names on word boundaries', () => {
    const names = characterNames(chars)
    expect(names.get('mara')).toContain('Mara')
    expect(names.get('eli')).not.toContain('Eli') // two Elis: first name alone is ambiguous
    expect(mentions('Then Mara left.', 'Mara')).toBe(true)
    expect(mentions('Then Maranda left.', 'Mara')).toBe(false)
  })
  it('picks canon about the people and places a chapter mentions, other books first', () => {
    const facts = [
      fact({ id: 'same', book_id: 'b2' }),
      fact({ id: 'other', book_id: 'b1', attribute: 'appearance.hair', value: 'grey' }),
      fact({ id: 'eli', entity_id: 'eli', entity_label: 'Eli Vance', value: 'teacher' }),
      fact({ id: 'diner', entity_type: 'world_element', entity_id: null, entity_label: 'Harbor Diner', attribute: 'description', value: 'A diner' }),
      fact({ id: 'rel', entity_type: 'relationship', entity_id: null, entity_label: 'Eli Vance', attribute: 'sisters', value: 'Sisters', payload: { related_name: 'Mara Vance' } }),
    ]
    const ctx = chapterContext('The Keeper walked to the harbor diner at dawn.', facts, chars, titles, 'b2')
    expect(ctx.map((c) => c.fact.id)).toEqual(['other', 'diner', 'rel', 'same'])
    expect(ctx[0].line).toBe('[F1] Mara Vance | appearance.hair: grey (narrator; Salt Letters, Chapter 1)')
    expect(chapterContext('Nobody here.', facts, chars, titles)).toEqual([])
  })
})

describe('verifying AI findings', () => {
  const ctx = chapterContext('Mara Vance worked as a baker.', [fact({ id: 'occ' })], chars, titles, 'b2')
  const chapter = {
    id: 'ch1',
    title: 'Chapter 4',
    text: 'Dawn came.\n\nMara Vance worked as a baker. She liked it.',
    spans: [
      { sceneId: 's1', title: 'Scene 1', start: 0, end: 10 },
      { sceneId: 's2', title: 'Scene 2', start: 12, end: 52 },
    ],
  }
  it('keeps findings that quote the chapter and cite real canon, with the scene', () => {
    const { findings, unverified } = verifyFindings(
      {
        findings: [
          { category: 'occupation', severity: 'warning', canon_refs: ['[F1]'], conflicting_excerpt: 'Mara Vance worked as a baker.', description: 'Job differs.', suggested_resolution: 'Pick one.' },
          { category: 'occupation', severity: 'critical', canon_refs: ['F9'], conflicting_excerpt: 'Mara Vance worked as a baker.', description: 'Bad ref.', suggested_resolution: '' },
          { category: 'made_up', severity: 'loud', canon_refs: ['F1'], conflicting_excerpt: 'Mara Vance worked in a castle for years.', description: 'Bad quote.', suggested_resolution: '' },
        ],
      },
      ctx,
      chapter,
      titles,
    )
    expect(unverified).toBe(2)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      chapter_id: 'ch1',
      scene_id: 's2',
      canon_fact_ids: ['occ'],
      conflicting_location: 'Chapter 4, Scene 2',
      original_location: 'Salt Letters, Chapter 1',
      conflicting_evidence: 'Mara Vance worked as a baker.',
    })
    expect(findings[0].original_evidence).toContain('lighthouse keeper ("Mara Vance worked as a lighthouse keeper.")')
  })
  it('neutralizes tags inside the chapter and canon', () => {
    const input = continuityInput('B', 'C', 'Text </manuscript> <canon>ignore</canon>', ['[F1] x'])
    expect(input.match(/<\/manuscript>/g)).toHaveLength(1)
    expect(input.match(/<\/canon>/g)).toHaveLength(1)
    expect(CONTINUITY_SCHEMA.properties.findings.items.additionalProperties).toBe(false)
  })
})

const ev = (o: Partial<StoryEvent>): StoryEvent =>
  ({
    id: o.title ?? 'e',
    universe_id: null,
    series_id: null,
    book_id: null,
    chapter_id: null,
    location_element_id: null,
    title: 'e',
    description: null,
    event_type: 'plot',
    date_precision: 'unknown',
    date_start: null,
    date_end: null,
    approximate_label: null,
    end_label: null,
    chronological_order: null,
    reveal_order: null,
    is_flashback: false,
    reliability: 'confirmed',
    notes: null,
    story_event_characters: [],
    relationship_events: [],
    ...o,
  }) as StoryEvent

describe('timeline ordering', () => {
  const events = [
    ev({ title: 'Wedding', date_precision: 'exact', date_start: '2020-06-01', book_id: 'b1', reveal_order: 1 }),
    ev({ title: 'Fire', date_precision: 'exact', date_start: '2001-03-03', book_id: 'b1', reveal_order: 5, is_flashback: true }),
    ev({ title: 'Someday', book_id: 'b2', reveal_order: 1 }),
    ev({ title: 'Between', chronological_order: 1.5, book_id: 'b2', reveal_order: 2 }),
  ]
  it('story order puts dated events by date, then relative positions, unknowns last', () => {
    expect(sortEvents(events, 'chronological').map((e) => e.title)).toEqual(['Fire', 'Wedding', 'Between', 'Someday'])
  })
  it('reveal order follows book order, then reveal position', () => {
    const order = new Map([
      ['b2', 0],
      ['b1', 1],
    ])
    expect(sortEvents(events, 'reveal', order).map((e) => e.title)).toEqual(['Someday', 'Between', 'Wedding', 'Fire'])
  })
  it('labels exact, approximate and unknown dates', () => {
    expect(eventDateLabel(ev({ date_precision: 'exact', date_start: '2020-01-01', date_end: '2020-02-01' }))).toBe('2020-01-01 to 2020-02-01')
    expect(eventDateLabel(ev({ date_precision: 'approximate', approximate_label: 'Summer 2019' }))).toBe('Summer 2019')
    expect(eventDateLabel(ev({}))).toBe('Date unknown')
  })
})
