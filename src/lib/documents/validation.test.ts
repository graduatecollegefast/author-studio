import {
  buildStoragePath,
  checkMagicBytes,
  getExtension,
  sanitizeFileName,
  validateCoverFile,
  validateManuscriptFile,
} from './validation'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('manuscript validation', () => {
  it('accepts the five supported types and rejects others', () => {
    for (const name of ['a.docx', 'b.PDF', 'c.epub', 'd.txt', 'e.md']) {
      expect(validateManuscriptFile(name, 100).ok).toBe(true)
    }
    expect(validateManuscriptFile('virus.exe', 100)).toEqual({ ok: false, error: expect.stringMatching(/Unsupported/) })
    expect(validateManuscriptFile('book.doc', 100).ok).toBe(false)
    expect(validateManuscriptFile('noext', 100).ok).toBe(false)
  })

  it('enforces size limits', () => {
    expect(validateManuscriptFile('a.txt', 0).ok).toBe(false)
    expect(validateManuscriptFile('a.txt', 100 * 1024 * 1024).ok).toBe(true)
    expect(validateManuscriptFile('a.txt', 100 * 1024 * 1024 + 1).ok).toBe(false)
    expect(validateCoverFile('c.png', 11 * 1024 * 1024).ok).toBe(false)
    expect(validateCoverFile('c.gif', 10).ok).toBe(false)
  })

  it('maps extension to the declared MIME type', () => {
    expect(validateManuscriptFile('x.md', 5)).toEqual({ ok: true, ext: 'md', mime: 'text/markdown' })
    expect(getExtension('dir/My.Book.DOCX')).toBe('docx')
  })

  it('sanitizes names against traversal and odd characters', () => {
    expect(sanitizeFileName('../../etc/passwd.txt')).toBe('passwd.txt')
    expect(sanitizeFileName('..\\..\\win.ini.md')).toBe('win.ini.md')
    expect(sanitizeFileName('My Novel: Draft #3?.docx')).toBe('My-Novel-Draft-3.docx')
    expect(sanitizeFileName('....docx')).toBe('file.docx')
    expect(sanitizeFileName('a'.repeat(300) + '.pdf').length).toBeLessThanOrEqual(84)
    expect(sanitizeFileName('Café story.txt')).toBe('Cafe-story.txt')
  })

  it('builds storage paths inside the owner folder', () => {
    const p = buildStoragePath('user-1', 'book-2', 'file-3', '../x/../../evil.pdf')
    expect(p).toBe('user-1/book-2/file-3-evil.pdf')
    expect(p.split('/')).toHaveLength(3)
  })
})

describe('magic byte checks', () => {
  it('recognizes PDFs', () => {
    expect(checkMagicBytes('pdf', bytes('%PDF-1.7\n...'))).toBeNull()
    expect(checkMagicBytes('pdf', bytes('<html>'))).toMatch(/PDF/)
  })

  it('recognizes DOCX and EPUB zip containers', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])
    expect(checkMagicBytes('docx', zip)).toBeNull()
    expect(checkMagicBytes('docx', bytes('%PDF-'))).toMatch(/Word/)
    expect(checkMagicBytes('epub', zip)).toMatch(/not a valid EPUB/)
    const epub = new Uint8Array([...zip, ...bytes('xxxxxxxxxxxxxxxxxxxxxxxxmimetypeapplication/epub+zip')])
    expect(checkMagicBytes('epub', epub)).toBeNull()
  })

  it('accepts UTF-8 text and rejects binary', () => {
    expect(checkMagicBytes('txt', bytes('Chapter One\n\nShe said, “hello.” Café.'))).toBeNull()
    expect(checkMagicBytes('md', bytes('# Title\n\n*italic*'))).toBeNull()
    expect(checkMagicBytes('txt', new Uint8Array([0x4d, 0x5a, 0x00, 0x01, 0x02]))).toMatch(/binary/)
    expect(checkMagicBytes('txt', new Uint8Array())).toMatch(/binary/)
  })

  it('accepts text whose sample ends mid-character', () => {
    const full = bytes('abc “quoted”')
    const cut = full.subarray(0, full.length - 1) // splits the 3-byte closing quote
    expect(checkMagicBytes('txt', cut)).toBeNull()
  })
})
