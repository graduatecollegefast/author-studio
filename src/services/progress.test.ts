import { goalProgress, goalStreak, localDateString, netWords } from './progress'

describe('writing progress', () => {
  it('formats local dates', () => {
    expect(localDateString(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
  it('computes net words and goal progress', () => {
    expect(netWords({ day: 'x', words_added: 900, words_removed: 150 })).toBe(750)
    expect(netWords({ day: 'x', words_added: 10, words_removed: 50 })).toBe(0)
    expect(goalProgress(750, 1000)).toEqual({ pct: 75, met: false })
    expect(goalProgress(1200, 1000)).toEqual({ pct: 100, met: true })
    expect(goalProgress(500, null)).toBeNull()
  })
  it('counts a streak through today or yesterday', () => {
    const s = (day: string, n: number) => ({ day, words_added: n, words_removed: 0 })
    const stats = [s('2026-10-19', 600), s('2026-10-20', 500), s('2026-10-21', 700), s('2026-10-22', 100)]
    expect(goalStreak(stats, 500, '2026-10-22')).toBe(3) // today not met yet; streak through yesterday
    expect(goalStreak([...stats.slice(0, 3), s('2026-10-22', 520)], 500, '2026-10-22')).toBe(4)
    expect(goalStreak(stats, 650, '2026-10-22')).toBe(1)
    expect(goalStreak(stats, null, '2026-10-22')).toBe(0)
  })
})
