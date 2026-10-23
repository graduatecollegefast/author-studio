import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { slug, tiptapToBlocks, type ExportDoc } from '../../netlify/functions/_shared/export/model'
import { render, toMd, toTxt } from '../../netlify/functions/_shared/export/render'
import { BACKUP_TABLES, makeRemap, parseBackup } from '../../netlify/functions/_shared/export/backup'
import { docPlainText, replaceInDoc, type TNode } from '../../src/lib/editorial/replace'
import { verifyEditorial } from '../../netlify/functions/_shared/editorial/job'

const scene = (paras: TNode[]): TNode => ({ type: 'doc', content: paras })
const para = (...runs: TNode[]): TNode => ({ type: 'paragraph', content: runs })
const t = (text: string, ...marks: string[]): TNode => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}) })

const doc: ExportDoc = {
  title: 'The Tide Keeper',
  author: 'Ann Writer',
  sections: [
    {
      title: 'Chapter One',
      blocks: tiptapToBlocks(
        scene([
          para(t('Mara ran '), t('fast', 'italic'), t(' and '), t('hard', 'bold'), t('.')),
          { type: 'horizontalRule' },
          para(t('Night fell & the <sea> rose.')),
        ]),
      ),
    },
    { title: 'Chapter Two', blocks: tiptapToBlocks(scene([para(t('Morning came.'))])) },
  ],
}

describe('export model', () => {
  it('keeps paragraphs, scene breaks, bold and italic from editor content', () => {
    const b = doc.sections[0].blocks
    expect(b.map((x) => x.kind)).toEqual(['paragraph', 'break', 'paragraph'])
    expect(b[0]).toMatchObject({
      runs: [{ text: 'Mara ran ' }, { text: 'fast', italic: true }, { text: ' and ' }, { text: 'hard', bold: true }, { text: '.' }],
    })
  })
  it('makes safe file names', () => {
    expect(slug('Café: The Tide / Keeper!')).toBe('cafe-the-tide-keeper')
    expect(slug('***')).toBe('export')
  })
})

describe('export formats', () => {
  it('TXT and Markdown keep chapter order, titles, breaks and emphasis', () => {
    const txt = toTxt(doc)
    expect(txt.indexOf('CHAPTER ONE')).toBeLessThan(txt.indexOf('CHAPTER TWO'))
    expect(txt).toContain('* * *')
    const md = toMd(doc)
    expect(md).toContain('## Chapter One')
    expect(md).toContain('Mara ran *fast* and **hard**.')
    expect(md).toContain('* * *')
    expect(md.indexOf('## Chapter One')).toBeLessThan(md.indexOf('## Chapter Two'))
  })

  it('DOCX is a valid Word package with headings, italic and bold runs', async () => {
    const zip = await JSZip.loadAsync(await render(doc, 'docx', 'x'))
    const body = await zip.file('word/document.xml')!.async('string')
    expect(zip.file('[Content_Types].xml')).toBeTruthy()
    expect(body).toContain('<w:pStyle w:val="Heading1"/>')
    expect(body).toContain('<w:rPr><w:i/></w:rPr><w:t xml:space="preserve">fast</w:t>')
    expect(body).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">hard</w:t>')
    expect(body).toContain('Night fell &amp; the &lt;sea&gt; rose.')
    expect(body.indexOf('Chapter One')).toBeLessThan(body.indexOf('Chapter Two'))
  })

  it('EPUB has an uncompressed mimetype first, a contents list and a file per chapter', async () => {
    const bytes = await render(doc, 'epub', '00000000-0000-4000-8000-000000000000')
    expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe('mimetype')
    const zip = await JSZip.loadAsync(bytes)
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip')
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav.indexOf('Chapter One')).toBeLessThan(nav.indexOf('Chapter Two'))
    const ch1 = await zip.file('OEBPS/chapter-1.xhtml')!.async('string')
    expect(ch1).toContain('<em>fast</em>')
    expect(ch1).toContain('<strong>hard</strong>')
    expect(ch1).toContain('class="break"')
  })

  it('PDF is valid, embeds the font and starts each chapter on a new page', async () => {
    const pdf = await PDFDocument.load(await render(doc, 'pdf', 'x'))
    expect(pdf.getPageCount()).toBe(3) // title page plus one per chapter
    expect(pdf.getTitle()).toBe('The Tide Keeper')
  }, 30_000)
})

describe('editorial revisions', () => {
  it('replaces only the reviewed passage and keeps formatting around it', () => {
    const d = scene([para(t('She ran very fast. '), t('Then she stopped.', 'italic')), para(t('Next paragraph.'))])
    const out = replaceInDoc(d, 'ran very fast', 'sprinted')!
    expect(out.content![0].content).toEqual([t('She sprinted. '), t('Then she stopped.', 'italic')])
    expect(out.content![1]).toEqual(d.content![1])
    expect(d.content![0].content![0].text).toBe('She ran very fast. ') // original untouched
    expect(docPlainText(out)).toBe('She sprinted. Then she stopped.\n\nNext paragraph.')
  })
  it('handles a passage that spans formatting runs', () => {
    const d = scene([para(t('A '), t('bold', 'bold'), t(' move here.'))])
    const out = replaceInDoc(d, 'bold move', 'brave step')!
    expect(docPlainText(out)).toBe('A brave step here.')
    expect(out.content![0].content![1]).toEqual(t('brave step', 'bold'))
  })
  it('refuses when the passage is gone or crosses paragraphs', () => {
    const d = scene([para(t('One.')), para(t('Two.'))])
    expect(replaceInDoc(d, 'Three.', 'x')).toBeNull()
    expect(replaceInDoc(d, 'One.\n\nTwo.', 'x')).toBeNull()
  })
  it('keeps only findings whose passage is in the chapter, with revisions inside one scene paragraph', () => {
    const sc = (id: string, text: string) => ({ id, title: id, position: 0, content_text: text, revision: 3 })
    const text = 'The harbor lights went dark all at once.\n\nMara counted the boats twice before she spoke.'
    const chapter = { id: 'c1', title: 'One', text, spans: [{ scene: sc('s1', text), start: 0, end: text.length }] }
    const out = verifyEditorial(
      {
        findings: [
          {
            category: 'Word Choice',
            severity: 'warning',
            description: 'd',
            passage: 'the harbor lights went dark',
            revision: 'The harbor lights died',
            explanation: 'e',
          },
          {
            category: 'pacing',
            severity: 'bogus',
            description: 'd',
            passage: 'went dark all at once. Mara counted the boats',
            revision: 'x',
            explanation: 'e',
          },
          {
            category: 'clarity',
            severity: 'critical',
            description: 'd',
            passage: 'This passage is invented by the model entirely.',
            revision: 'x',
            explanation: 'e',
          },
        ],
      },
      'line',
      chapter,
    )
    expect(out.unverified).toBe(1)
    expect(out.findings).toHaveLength(2)
    expect(out.findings[0]).toMatchObject({
      category: 'word_choice',
      passage: 'The harbor lights went dark',
      revision: { original: 'The harbor lights went dark', proposed: 'The harbor lights died' },
    })
    expect(out.findings[0].revision!.scene.revision).toBe(3)
    expect(out.findings[1].severity).toBe('suggestion')
    expect(out.findings[1].revision).toBeNull() // crosses a paragraph
  })
})

describe('backup restore', () => {
  it('maps every old id, in text, arrays and JSON, and moves file paths to the new account', () => {
    const oldOwner = '11111111-1111-4111-8111-111111111111'
    const newOwner = '22222222-2222-4222-8222-222222222222'
    const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const remap = makeRemap(new Map([[a, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']]), oldOwner, newOwner)
    expect(remap(a)).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    expect(remap([a.toUpperCase(), b])).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccccccc', b])
    expect(remap({ x: { entity_id: a }, n: 3 })).toEqual({ x: { entity_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, n: 3 })
    expect(remap(`${oldOwner}/${a}/file.docx`)).toBe(`${newOwner}/cccccccc-cccc-4ccc-8ccc-cccccccccccc/file.docx`)
  })
  it('restores tables only after the tables they depend on', () => {
    const order = (t: string) => BACKUP_TABLES.indexOf(t as (typeof BACKUP_TABLES)[number])
    for (const [child, parent] of [
      ['scenes', 'chapters'],
      ['scenes', 'characters'],
      ['chapters', 'manuscript_files'],
      ['fact_sources', 'document_chunks'],
      ['fact_sources', 'canon_facts'],
      ['revision_proposals', 'editorial_findings'],
      ['relationship_events', 'story_events'],
      ['world_element_links', 'story_events'],
      ['ai_messages', 'ai_conversations'],
    ])
      expect(order(child), `${child} after ${parent}`).toBeGreaterThan(order(parent))
  })
  it('rejects files that are not backups', () => {
    expect(() => parseBackup({ hello: 1 })).toThrow(/not an Author Studio backup/)
    expect(() => parseBackup({ format: 'author-studio-backup', version: 99, owner_id: 'x', tables: {} })).toThrow(/newer version/)
    expect(() => parseBackup({ format: 'author-studio-backup', version: 1, owner_id: 'x', tables: { books: [1] } })).toThrow(/damaged/)
  })
})
