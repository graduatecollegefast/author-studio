// @vitest-environment node
import { extractManuscript, parseInlineMarkdown } from '../../netlify/functions/_shared/extract'
import { classifyFurniture, rejoinSplitWords } from '../../netlify/functions/_shared/cleanup'
import { blocksToTiptap, buildChunks, splitIntoChapters, looksLikeChapterHeading } from '../../src/lib/documents/structure'
import { makeBlankPdf, makeConvertedDocx, makeDocx, makeEpub, makePdf, makeTypesetPdf } from './fixtures'

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
    // Chapters are not split into scenes; the scene break stays in the text as a divider.
    expect(r.chapters[0].scenes).toHaveLength(1)
    expect(r.chapters[0].scenes[0].text.startsWith('Mara found the first letter in the bread box.\n\nIt smelled of the sea.\n\n* * *\n\n')).toBe(true)
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
    expect(r.chapters[0].scenes).toHaveLength(1)
    expect(r.chapters[0].scenes[0].blocks.some((b) => b.kind === 'break')).toBe(true)
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
    expect(r.chapters[0].scenes).toHaveLength(1)
    expect(r.chapters[0].scenes[0].blocks.filter((b) => b.kind === 'break')).toHaveLength(1)
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

describe('print-layout cleanup', () => {
  const known = ['Soror Love', 'Shaun J. Phree']
  const allText = (r: Awaited<ReturnType<typeof extractManuscript>>) =>
    r.chapters.filter((c) => !c.frontMatter).flatMap((c) => c.scenes.map((s) => s.text)).join('\n\n')

  it('cleans a Word file converted from a print layout', async () => {
    const r = await extractManuscript('docx', await makeConvertedDocx(), { knownStrings: known })
    const text = allText(r)

    // Running headers, footers and page numbers are gone.
    expect(text).not.toMatch(/SHAUN J\. PHREE|SOROR LOVE \d|^\d+$/m)
    expect(text).not.toContain('HEADER PART TEXT')
    expect(r.cleanup?.runningHeadsRemoved).toBe(7)
    expect(r.cleanup?.pageNumbersRemoved).toBe(1)

    // Drop cap and its text-box first line rejoin the paragraph, in order, once.
    expect(text).toContain('People were trying to find their way to their rooms.')
    expect(text.match(/eople were/g)).toHaveLength(1)

    // Paragraph split by a page is whole again, and split words are repaired.
    expect(text).toContain('did not bother to look up at Lauren; she continued to swipe through her phone.')
    expect(text).toContain('Lauren moved swiftly through the room.')
    expect(text).toContain('catching the attention of the clerk')
    expect(text).toContain('Nobody mentioned the incidents from last year. It was a part of the past.')

    // Table text is kept.
    expect(text).toContain('A letter was taped inside the drawer.')

    // Title page and copyright never become a story chapter.
    expect(text).not.toMatch(/Copyright|All rights reserved|Also by/)
    expect(r.chapters.filter((c) => !c.frontMatter).map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5'])
    // The last "Also by" title is not glued onto the first sentence of the story.
    expect(text).not.toContain('Classified People')
    expect(r.chapters.find((c) => c.title === 'Chapter 1')?.scenes[0].text.startsWith('People were trying')).toBe(true)
  })

  it('flags longer front matter instead of importing it as a chapter', async () => {
    const lines = ['Copyright © 2024 by Shaun J. Phree', 'All rights reserved. ' + 'No part of this book may be reproduced. '.repeat(30), 'Also by Shaun J. Phree']
    const txt = [...lines, 'Chapter 1', 'Story begins here.', 'Chapter 2', 'It continues.'].join('\n\n')
    const r = await extractManuscript('txt', new TextEncoder().encode(txt), { knownStrings: known })
    expect(r.chapters[0]).toMatchObject({ title: 'Front matter', frontMatter: true })
    expect(r.chapters.slice(1).map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2'])
  })

  it('reads a typeset PDF in order and removes alternating headers and page numbers', async () => {
    const r = await extractManuscript('pdf', await makeTypesetPdf(), { knownStrings: known })
    const text = allText(r)
    expect(r.chapters.map((c) => c.title)).toEqual(['Chapter 1'])
    expect(text).not.toMatch(/SHAUN|SOROR LOVE|^\d+$/m)
    expect(text).toContain('People were trying to find their way to their rooms.')
    expect(text).toContain('a clerk looked up with polite interest and a tired smile.')
    expect(text).toContain('did not bother to look up at Lauren; she kept swiping through her phone.')
    expect(text).toContain('Lauren waited for a long, quiet moment before she spoke again, and the whole lobby turned to listen.')
    const paras = r.chapters[0].scenes[0].blocks.length
    expect(paras).toBe(5)
  })

  it('recognizes furniture without touching story lines', () => {
    const counts = new Map([['soror love', 30], ['shaun j phree', 30]])
    const k = ['soror love', 'shaun j phree']
    expect(classifyFurniture('SOROR LOVE 3', k, counts)).toBe('running-head')
    expect(classifyFurniture('2 SHAUN J. PHREE', k, counts)).toBe('running-head')
    expect(classifyFurniture('214', k, counts)).toBe('page-number')
    expect(classifyFurniture('Page 7 of 300', k, counts)).toBe('page-number')
    expect(classifyFurniture('“Soror love is real,” she said.', k, counts)).toBeNull()
    expect(classifyFurniture('Chapter 3', k, new Map([['chapter', 40]]))).toBeNull()
    expect(classifyFurniture('CHAPTER TWELVE', k, new Map([['chapter twelve', 4]]))).toBeNull()
    expect(classifyFurniture('She was 21.', k, counts)).toBeNull()
  })

  it('rejoins split words but leaves real word pairs alone', () => {
    const doc = new Map([['janelle', 12]])
    const fix = (t: string) => rejoinSplitWords(t, doc).text
    expect(fix('the inci dents and the at tention')).toBe('the incidents and the attention')
    expect(fix('she moved swift ly, con sequences, pa per, annoy ance')).toBe('she moved swiftly, consequences, paper, annoyance')
    expect(fix('Jan elle laughed')).toBe('Janelle laughed')
    expect(fix('a part of it, any one of them, in to the room')).toBe('a part of it, any one of them, in to the room')
    expect(fix('the red car and the blue sky')).toBe('the red car and the blue sky')
    expect(fix('soft\u00adware')).toBe('software')
  })
})
