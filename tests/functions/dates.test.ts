import { describe, expect, it } from 'vitest'
import { ageOn, chapterDate, checkAges, detectDates, findAgeMentions, numberWord, parseBirth, resolveDates } from '../../src/lib/story/dates'

describe('reading dates from the text', () => {
  it('finds dates written out in the common ways', () => {
    const t = 'On March 3, 2024 she left. By the 5th of April 2024 it was over. Logged 2024-06-01. Signed 7/4/2024. Back in May 2023.'
    expect(detectDates(t).map((d) => [d.iso, d.precision])).toEqual([
      ['2024-03-03', 'day'],
      ['2024-04-05', 'day'],
      ['2024-06-01', 'day'],
      ['2024-07-04', 'day'],
      ['2023-05-01', 'month'],
    ])
  })
  it('uses an earlier year for "March 3" only when one is known, and skips impossible dates', () => {
    expect(detectDates('By March 3rd the snow melted.')).toEqual([])
    expect(detectDates('By March 3rd the snow melted.', { defaultYear: 2024 })[0]).toMatchObject({ iso: '2024-03-03', yearInferred: true })
    expect(detectDates('February 30, 2024 never came.')).toEqual([])
    expect(detectDates('She will march 3 miles.')).toEqual([])
  })
  it('takes the first date in a chapter', () => {
    expect(chapterDate('Nothing yet. Then June 1, 2020 and later July 2, 2020.')?.iso).toBe('2020-06-01')
  })
  it('carries a date forward to chapters that do not state one', () => {
    const r = resolveDates(
      [
        { id: 'a', title: 'One', story_date: null },
        { id: 'b', title: 'Two', story_date: '2024-03-03' },
        { id: 'c', title: 'Three', story_date: null },
      ],
      '2024-03-01',
    )
    expect(r.map((x) => [x.date, x.from, x.fromTitle])).toEqual([
      ['2024-03-01', 'book', undefined],
      ['2024-03-03', 'chapter', undefined],
      ['2024-03-03', 'earlier', 'Two'],
    ])
  })
})

describe('ages', () => {
  it('reads birth dates and works out ages, including around birthdays', () => {
    const b = parseBirth('January 12, 1990')!
    expect(ageOn(b, '2024-01-11')).toEqual({ min: 33, max: 33 })
    expect(ageOn(b, '2024-01-12')).toEqual({ min: 34, max: 34 })
    expect(ageOn(parseBirth('1990')!, '2024-06-01')).toEqual({ min: 33, max: 34 })
    expect(parseBirth('unknown')).toBeNull()
  })
  it('reads ages written as numbers or words', () => {
    expect([numberWord('34'), numberWord('thirty-four'), numberWord('Thirty four'), numberWord('nineteen'), numberWord('lots')]).toEqual([
      34,
      34,
      34,
      19,
      null,
    ])
    const t = 'Mara, 34, opened the door. Mara was thirty-five years old by then. The 36-year-old Mara laughed. Mara was 5 minutes late. Eli was 40.'
    expect(findAgeMentions(t, ['Mara']).map((m) => m.age)).toEqual([34, 35, 36])
  })
  it('flags ages that do not match the birth date on the story date, and wrong profile ages', () => {
    const issues = checkAges(
      [
        {
          id: 'c1',
          title: 'Chapter 1',
          date: '2024-03-03',
          dateNote: 'March 3, 2024',
          scenes: [{ id: 's1', title: 'Scene 1', text: 'Mara, 34, opened the door. Later, Mara was thirty-six years old in her mind.' }],
        },
      ],
      [{ id: 'm', name: 'Mara Vance', names: ['Mara Vance', 'Mara'], dateOfBirth: 'January 12, 1990', age: '30' }],
      null,
    )
    expect(issues.map((i) => [i.chapterId, i.conflicting])).toEqual([
      [null, 'Age: 30'],
      ['c1', 'Mara was thirty-six years old'],
    ])
    expect(issues[1].description).toBe('Mara Vance is given as 36 here, but born January 12, 1990 makes them 34 on March 3, 2024.')
  })
})

describe('chapter dates for a book', () => {
  it('prefers your dates, then saved, then the text, then carries the last one forward', async () => {
    const { effectiveDates } = await import('../../src/lib/story/dates')
    const r = effectiveDates(
      [
        { id: '1', title: 'One', story_date: null, text: 'It was June 1, 2020 when it began.' },
        { id: '2', title: 'Two', story_date: null, text: 'No date here.' },
        { id: '3', title: 'Three', story_date: null, text: 'By June 9th she knew.' },
        { id: '4', title: 'Four', story_date: '2021-01-01', story_date_source: 'author', text: 'March 3, 2024 is written here.' },
        { id: '5', title: 'Five', story_date: null, text: 'Quiet.' },
      ],
      null,
    )
    expect(r.map((x) => [x.date, x.from, x.note])).toEqual([
      ['2020-06-01', 'text', '"June 1, 2020"'],
      ['2020-06-01', 'earlier', 'carried from One'],
      ['2020-06-09', 'text', '"June 9th"'],
      ['2021-01-01', 'author', 'set by you'],
      ['2021-01-01', 'earlier', 'carried from Four'],
    ])
  })
})
