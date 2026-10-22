// @vitest-environment node
import { extractManuscript, parseInlineMarkdown, blocksFromPdfPages } from '../../netlify/functions/_shared/extract'
import { blocksToTiptap, buildChunks, splitIntoChapters, looksLikeChapterHeading } from '../../src/lib/documents/structure'
import { makeBlankPdf, makeDocx, makeEpub, makePdf } from './fixtures'

const enc = (s: string) => new TextEncoder().encode(s)

describe('chapter detection', () => {
  it('recognizes common chapter headings', () => {
    for (const t of ['Chapter 1', 'CHAPTER TWELVE', 'Chapter XIV: The Ferry', 'Prologue', 'Epilogue', 'Part Two', 'Chapter twenty-one'])
      expect(looksLikeChapterHeading(t), t).toBe(true)
    for (const t of ['She chaptered nothing.', 'The chapter of her life ended when the ferry left the harbor for good.', ''])
      expect(looksLikeChapterHeading(t), t).toBe(false)
  })
})

describe('TXT', () => {
  it('splits chapters, scenes, and paragraphs', async () => {
    const text = [
      'THE SALT LETTERS',
      '',
      'Chapter One',
      '',
      'Mara found the first letter in the bread box.',
      '',
      'It smelled of the sea.',
      '',
      '* * *',
      '',
      'Later, at the harbor, she read it again.',
      '',
      'Chapter Two',
      '',
      'Nobody came to the funeral.',
    ].join('\r\n')
    const r = await extractManuscript('txt', enc(text))
    expect(r.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two'])
    expect(r.chapters[0].scenes).toHaveLength(2)
    expect(r.chapters[0].scenes[0].text).toBe('Mara found the first letter in the bread box.\n\nIt smelled of the sea.')
    expect(r.wordCount).toBe(9 + 5 + 8 + 5)
  })

  it('treats a document with no headings as one chapter', async () => {
    const r = await extractManuscript('txt', enc('Just a short story.\n\nWith two paragraphs.'))
    expect(r.chapters).toHaveLength(1)
    expect(r.chapters[0].title).toBe('Chapter 1')
    expect(r.chapters[0].detected).toBe(false)
  })

  it('decodes Windows-1252 text', async () => {
    const bytes = new Uint8Array([0x93, 0x48, 0x69, 0x94, 0x20, 0x63, 0x61, 0x66, 0xe9])
    const r = await extractManuscript('txt', bytes)
    expect(r.chapters[0].scenes[0].text).toBe('“Hi” café')
  })
})

describe('Markdown', () => {
  it('keeps headings, bold, italic, and breaks', async () => {
    const md = '# Book Title\n\n## Chapter 1\n\nShe said *no* and meant **it**.\n\n***\n\nNew scene.\n\n## Chapter 2\n\nEnd.'
    const r = await extractManuscript('md', enc(md))
    expect(r.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2'])
    const para = r.chapters[0].scenes[0].blocks[0]
    expect(para).toEqual({
      kind: 'paragraph',
      runs: [{ text: 'She said ' }, { text: 'no', italic: true }, { text: ' and meant ' }, { text: 'it', bold: true }, { text: '.' }],
    })
    expect(r.chapters[0].scenes).toHaveLength(2)
  })

  it('does not treat lone asterisks as italics', () => {
    expect(parseInlineMarkdown('2 * 3 = 6')).toEqual([{ text: '2 * 3 = 6' }])
  })
})

describe('DOCX', () => {
  it('reads headings and inline formatting from a real Word file', async () => {
    const bytes = await makeDocx([
      { style: 'Title', runs: [{ text: 'Velvet Ledger' }] },
      { style: 'Heading1', runs: [{ text: 'Chapter 1: Accounts' }] },
      { runs: [{ text: 'The ledger was ' }, { text: 'green', i: true }, { text: ' and ' }, { text: 'heavy', b: true }, { text: '.' }] },
      { runs: [{ text: '#' }] },
      { runs: [{ text: 'Second scene begins.' }] },
      { style: 'Heading1', runs: [{ text: 'Chapter 2: Debts' }] },
      { runs: [{ text: 'Her mother kept every receipt.' }] },
    ])
    const r = await extractManuscript('docx', bytes)
    expect(r.chapters.map((c) => c.title)).toEqual(['Chapter 1: Accounts', 'Chapter 2: Debts'])
    expect(r.chapters[0].scenes).toHaveLength(2)
    expect(r.chapters[0].scenes[0].blocks[0]).toEqual({
      kind: 'paragraph',
      runs: [{ text: 'The ledger was ' }, { text: 'green', italic: true }, { text: ' and ' }, { text: 'heavy', bold: true }, { text: '.' }],
    })
  })
})

describe('EPUB', () => {
  it('follows the spine, skips navigation, scripts, and styles', async () => {
    const bytes = await makeEpub('Harbor Lights', [
      { heading: 'Chapter One', paragraphs: ['Rain on the <em>pier</em>.', 'A &amp; B went home.'] },
      { heading: 'Chapter Two', paragraphs: ['Morning.'] },
    ])
    const r = await extractManuscript('epub', bytes)
    expect(r.title).toBe('Harbor Lights')
    expect(r.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two'])
    const all = r.chapters.flatMap((c) => c.scenes.map((s) => s.text)).join(' ')
    expect(all).toContain('A & B went home.')
    expect(all).not.toMatch(/alert|color:red|Table of contents/)
    expect(r.chapters[0].scenes[0].blocks[0]).toEqual({ kind: 'paragraph', runs: [{ text: 'Rain on the ' }, { text: 'pier', italic: true }, { text: '.' }] })
  })

  it('rejects files that are not EPUB packages', async () => {
    await expect(extractManuscript('epub', enc('not a zip'))).rejects.toThrow()
  })
})

describe('PDF', () => {
  it('rebuilds paragraphs and removes page numbers and running headers', async () => {
    const header = 'THE SALT LETTERS'
    const pages = [
      [header, 'Chapter One', '', 'Mara found the first letter in the bread box on a', 'Tuesday morning in late November.', 'It smelled of the sea.', '', '1'],
      [header, 'She read it twice before she let herself believe', 'it was real.', '', '2'],
      [header, 'Chapter Two', '', 'Nobody came to the funeral.', '', '3'],
      [header, 'The end of the second chapter arrived.', '', '4'],
    ]
    const r = await extractManuscript('pdf', await makePdf(pages))
    expect(r.pageCount).toBe(4)
    expect(r.needsOcr).toBe(false)
    expect(r.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two'])
    const text = r.chapters[0].scenes[0].text
    expect(text).toContain('Mara found the first letter in the bread box on a Tuesday morning in late November.')
    expect(text).not.toContain('THE SALT LETTERS')
    expect(text).not.toMatch(/\b[12]\b/)
  })

  it('flags scanned PDFs instead of importing empty content', async () => {
    const r = await extractManuscript('pdf', await makeBlankPdf(3))
    expect(r.needsOcr).toBe(true)
    expect(r.chapters).toEqual([])
    expect(r.warnings[0]).toMatch(/OCR/)
  })

  it('joins hyphenated line breaks', () => {
    const blocks = blocksFromPdfPages(['She was in-\ncredibly tired that night.'])
    expect(blocks[0]).toEqual({ kind: 'paragraph', runs: [{ text: 'She was incredibly tired that night.' }] })
  })
})

describe('import helpers', () => {
  it('builds TipTap documents with marks', () => {
    const doc = blocksToTiptap([
      { kind: 'paragraph', runs: [{ text: 'Hi ' }, { text: 'there', italic: true }] },
      { kind: 'break' },
      { kind: 'heading', level: 1, text: 'Inner' },
    ])
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'text', text: 'there', marks: [{ type: 'italic' }] }] },
      { type: 'horizontalRule' },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Inner' }] },
    ])
  })

  it('chunks on paragraph boundaries with exact offsets and chapter labels', () => {
    const para = (n: number) => ({ kind: 'paragraph' as const, runs: [{ text: `Sentence ${n} ` + 'word '.repeat(60).trim() + '.' }] })
    const blocks = [
      { kind: 'heading' as const, level: 1, text: 'Chapter 1' },
      ...Array.from({ length: 40 }, (_, i) => para(i)),
      { kind: 'heading' as const, level: 1, text: 'Chapter 2' },
      ...Array.from({ length: 40 }, (_, i) => para(i + 40)),
    ]
    const chapters = splitIntoChapters(blocks)
    const chunks = buildChunks(chapters, 4000)
    expect(chunks.length).toBeGreaterThan(4)
    const { text } = { text: chunks.map((c) => c.content).join('') }
    expect(text.length).toBeGreaterThan(0)
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(4000)
      expect(c.charEnd - c.charStart).toBe(c.content.length)
    }
    expect(chunks.some((c) => c.chapterLabel === 'Chapter 2')).toBe(true)
    expect(chunks.find((c) => c.content.startsWith('Chapter 2'))?.chapterLabel).toBe('Chapter 2')
    // Offsets are contiguous apart from skipped whitespace.
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].charStart).toBeGreaterThanOrEqual(chunks[i - 1].charEnd)
  })
})
