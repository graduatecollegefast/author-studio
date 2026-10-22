import { countWords, formatBytes, formatRelative, labelize } from './utils'

describe('utils', () => {
  it('counts words like the database does', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
    expect(countWords('One two\n\nthree  four')).toBe(4)
  })
  it('formats values', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(labelize('adults_only')).toBe('Adults Only')
    const now = new Date('2026-10-22T12:00:00Z')
    expect(formatRelative('2026-10-22T11:58:00Z', now)).toBe('2m ago')
    expect(formatRelative(null, now)).toBe('Never')
  })
})
