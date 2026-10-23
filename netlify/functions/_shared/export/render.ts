// Writers for TXT, Markdown, DOCX, EPUB and PDF from the shared export model.
import JSZip from 'jszip'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { clean, type ExportBlock, type ExportDoc, type Inline } from './model'

export type Format = 'txt' | 'md' | 'docx' | 'epub' | 'pdf'

export const MIME: Record<Format | 'zip' | 'json', string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  zip: 'application/zip',
  json: 'application/json',
}

const plain = (runs: Inline[]) => runs.map((r) => r.text).join('')

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------
export function toTxt(doc: ExportDoc): string {
  const out: string[] = [doc.title.toUpperCase()]
  if (doc.subtitle) out.push(doc.subtitle)
  if (doc.author) out.push(`by ${doc.author}`)
  if (doc.description) out.push('', doc.description)
  for (const s of doc.sections) {
    out.push('', '', s.title.toUpperCase(), '')
    for (const b of s.blocks) {
      if (b.kind === 'heading') out.push('', b.text, '')
      else if (b.kind === 'break') out.push('', '* * *', '')
      else out.push(plain(b.runs), '')
    }
  }
  return clean(out.join('\n').replace(/\n{4,}/g, '\n\n\n')).trim() + '\n'
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------
const mdEscape = (s: string) => s.replace(/([\\*_`[\]])/g, '\\$1').replace(/^(#{1,6}\s|>|\d+\.\s|[-+]\s)/, '\\$1')

function mdRuns(runs: Inline[]): string {
  return runs
    .map((r) => {
      const t = mdEscape(r.text)
      if (!t.trim()) return t
      // Keep surrounding spaces outside the markers so they still parse.
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(t)!
      const wrapped = r.bold && r.italic ? `***${core}***` : r.bold ? `**${core}**` : r.italic ? `*${core}*` : core
      return lead + wrapped + trail
    })
    .join('')
}

export function toMd(doc: ExportDoc): string {
  const out: string[] = [`# ${mdEscape(doc.title)}`]
  if (doc.subtitle) out.push('', `*${mdEscape(doc.subtitle)}*`)
  if (doc.author) out.push('', `by ${mdEscape(doc.author)}`)
  if (doc.description) out.push('', mdEscape(doc.description))
  for (const s of doc.sections) {
    out.push('', `## ${mdEscape(s.title)}`, '')
    for (const b of s.blocks) {
      if (b.kind === 'heading') out.push(`### ${mdEscape(b.text)}`, '')
      else if (b.kind === 'break') out.push('* * *', '')
      else out.push(`${b.style === 'quote' ? '> ' : ''}${mdRuns(b.runs)}`, '')
    }
  }
  return clean(out.join('\n')).trim() + '\n'
}

// ---------------------------------------------------------------------------
// DOCX (Office Open XML, written directly)
// ---------------------------------------------------------------------------
const xml = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function docxRuns(runs: Inline[]): string {
  return runs
    .flatMap((r) =>
      r.text.split('\n').map((part, i) => {
        const props = `${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}`
        return `${i > 0 ? '<w:r><w:br/></w:r>' : ''}<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(part)}</w:t></w:r>`
      }),
    )
    .join('')
}

const para = (style: string, inner: string) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${inner}</w:p>`

export async function toDocx(doc: ExportDoc): Promise<Uint8Array> {
  const body: string[] = [para('Title', docxRuns([{ text: doc.title }]))]
  if (doc.subtitle) body.push(para('Subtitle', docxRuns([{ text: doc.subtitle }])))
  if (doc.author) body.push(para('Author', docxRuns([{ text: `by ${doc.author}` }])))
  if (doc.description) body.push(para('Meta', docxRuns([{ text: doc.description }])))
  for (const s of doc.sections) {
    body.push(para('Heading1', docxRuns([{ text: s.title }])))
    let afterBreak = true
    for (const b of s.blocks) {
      if (b.kind === 'heading') {
        body.push(para(b.level === 2 ? 'Heading2' : 'Heading3', docxRuns([{ text: b.text }])))
        afterBreak = true
      } else if (b.kind === 'break') {
        body.push(para('SceneBreak', docxRuns([{ text: '* * *' }])))
        afterBreak = true
      } else {
        const style = b.style === 'meta' ? 'Meta' : b.style === 'quote' ? 'Quote' : afterBreak ? 'FirstParagraph' : 'BodyText'
        body.push(para(style, docxRuns(b.runs)))
        afterBreak = false
      }
    }
  }
  const font = '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia" w:eastAsia="Georgia"/>'
  const style = (id: string, name: string, pPr: string, rPr: string, extra = '') =>
    `<w:style w:type="paragraph" w:styleId="${id}"${id === 'BodyText' ? ' w:default="1"' : ''}><w:name w:val="${name}"/>${extra}<w:pPr>${pPr}</w:pPr><w:rPr>${font}${rPr}</w:rPr></w:style>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
${style('BodyText', 'Body Text', '<w:ind w:firstLine="432"/>', '')}
${style('FirstParagraph', 'First Paragraph', '<w:ind w:firstLine="0"/>', '', '<w:basedOn w:val="BodyText"/>')}
${style('Meta', 'Details', '<w:spacing w:after="120"/>', '<w:sz w:val="22"/>')}
${style('Quote', 'Quote', '<w:ind w:left="720" w:right="720"/>', '<w:i/>')}
${style('Title', 'Title', '<w:jc w:val="center"/><w:spacing w:before="2400" w:after="240"/>', '<w:b/><w:sz w:val="56"/>')}
${style('Subtitle', 'Subtitle', '<w:jc w:val="center"/><w:spacing w:after="240"/>', '<w:i/><w:sz w:val="32"/>')}
${style('Author', 'Author', '<w:jc w:val="center"/><w:spacing w:after="480"/>', '<w:sz w:val="28"/>')}
${style('Heading1', 'heading 1', '<w:keepNext/><w:pageBreakBefore/><w:jc w:val="center"/><w:spacing w:before="1440" w:after="480"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="36"/>')}
${style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="28"/>')}
${style('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/>', '<w:b/><w:i/><w:sz w:val="24"/>')}
${style('SceneBreak', 'Scene Break', '<w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/>', '')}
</w:styles>`
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  )
  zip.file('word/styles.xml', styles)
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  )
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(doc.title)}</dc:title><dc:creator>${xml(doc.author ?? '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`,
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// ---------------------------------------------------------------------------
// EPUB 3
// ---------------------------------------------------------------------------
function htmlRuns(runs: Inline[]): string {
  return runs
    .map((r) => {
      let t = xml(r.text).replace(/\n/g, '<br/>')
      if (r.italic) t = `<em>${t}</em>`
      if (r.bold) t = `<strong>${t}</strong>`
      return t
    })
    .join('')
}

function htmlBlocks(blocks: ExportBlock[]): string {
  let first = true
  return blocks
    .map((b) => {
      if (b.kind === 'heading') {
        first = true
        return `<h${b.level + 1}>${xml(b.text)}</h${b.level + 1}>`
      }
      if (b.kind === 'break') {
        first = true
        return '<p class="break">* * *</p>'
      }
      const cls = b.style === 'meta' ? ' class="meta"' : b.style === 'quote' ? ' class="quote"' : first ? ' class="first"' : ''
      first = false
      return `<p${cls}>${htmlRuns(b.runs)}</p>`
    })
    .join('\n')
}

const xhtml = (title: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><meta charset="UTF-8"/><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`

export async function toEpub(doc: ExportDoc, id: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  zip.file(
    'OEBPS/style.css',
    `body{font-family:serif;line-height:1.5;margin:0 5%}h1{text-align:center;margin:3em 0 1.5em}h2{margin:1.5em 0 .5em}h3{margin:1.2em 0 .4em;font-style:italic}p{margin:0;text-indent:1.5em}p.first,p.meta,p.break{text-indent:0}p.meta{margin:.3em 0}p.quote{margin:.5em 2em;font-style:italic;text-indent:0}p.break{text-align:center;margin:1em 0}.title{text-align:center;margin-top:20%}.title h1{font-size:2em}.title p{text-indent:0;margin:.5em 0}`,
  )
  const titleBody = `<section class="title" epub:type="titlepage"><h1>${xml(doc.title)}</h1>${doc.subtitle ? `<p><em>${xml(doc.subtitle)}</em></p>` : ''}${doc.author ? `<p>by ${xml(doc.author)}</p>` : ''}${doc.description ? `<p class="meta">${xml(doc.description)}</p>` : ''}</section>`
  zip.file('OEBPS/title.xhtml', xhtml(doc.title, titleBody))
  const items: string[] = ['<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>']
  const spine: string[] = ['<itemref idref="title"/>']
  const nav: string[] = []
  doc.sections.forEach((s, i) => {
    const f = `chapter-${i + 1}.xhtml`
    zip.file(`OEBPS/${f}`, xhtml(s.title, `<section epub:type="chapter"><h1>${xml(s.title)}</h1>\n${htmlBlocks(s.blocks)}</section>`))
    items.push(`<item id="c${i + 1}" href="${f}" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="c${i + 1}"/>`)
    nav.push(`<li><a href="${f}">${xml(s.title)}</a></li>`)
  })
  zip.file('OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${nav.join('')}</ol></nav>`))
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${id}</dc:identifier><dc:title>${xml(doc.title)}</dc:title>${doc.author ? `<dc:creator>${xml(doc.author)}</dc:creator>` : ''}<dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${items.join('')}</manifest><spine>${spine.join('')}</spine></package>`,
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' })
}

// ---------------------------------------------------------------------------
// PDF (6 x 9 inch trade paperback page, Newsreader embedded)
// ---------------------------------------------------------------------------
export async function toPdf(doc: ExportDoc): Promise<Uint8Array> {
  const fonts = await import('./fonts')
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'))
  const F = {
    regular: await pdf.embedFont(bytes(fonts.regular), { subset: true }),
    italic: await pdf.embedFont(bytes(fonts.italic), { subset: true }),
    bold: await pdf.embedFont(bytes(fonts.bold), { subset: true }),
    boldItalic: await pdf.embedFont(bytes(fonts.boldItalic), { subset: true }),
  }
  pdf.setTitle(doc.title)
  if (doc.author) pdf.setAuthor(doc.author)
  const W = 432
  const H = 648
  const M = 54
  const usable = W - 2 * M
  const ink = rgb(0.1, 0.1, 0.12)
  let page: PDFPage = pdf.addPage([W, H])
  let y = H - M
  const pages: PDFPage[] = [page]
  const newPage = () => {
    page = pdf.addPage([W, H])
    pages.push(page)
    y = H - M
  }
  const fontFor = (r: Inline) => (r.bold && r.italic ? F.boldItalic : r.bold ? F.bold : r.italic ? F.italic : F.regular)

  /** Lay out runs into lines that fit, then draw them; optional first-line indent and centering. */
  const drawRuns = (runs: Inline[], size: number, leading: number, opts: { indent?: number; center?: boolean; left?: number } = {}) => {
    const left = M + (opts.left ?? 0)
    const width = usable - (opts.left ?? 0) * 2
    type Word = { text: string; font: PDFFont; w: number; space: number }
    const words: Word[] = []
    const lines: Word[][] = []
    for (const r of runs) {
      const font = fontFor(r)
      const parts = clean(r.text).split(/(\n| +)/)
      for (const part of parts) {
        if (part === '\n') {
          words.push({ text: '\n', font, w: 0, space: 0 })
        } else if (/^ +$/.test(part)) {
          if (words.length) words[words.length - 1].space += font.widthOfTextAtSize(' ', size)
        } else if (part) {
          words.push({ text: part, font, w: font.widthOfTextAtSize(part, size), space: 0 })
        }
      }
    }
    let line: Word[] = []
    let lineW = opts.indent ?? 0
    for (const w of words) {
      if (w.text === '\n') {
        lines.push(line)
        line = []
        lineW = 0
        continue
      }
      const prevSpace = line.length ? line[line.length - 1].space : 0
      if (line.length && lineW + prevSpace + w.w > width) {
        lines.push(line)
        line = []
        lineW = 0
      }
      lineW += (line.length ? prevSpace : 0) + w.w
      line.push(w)
    }
    if (line.length) lines.push(line)
    lines.forEach((ln, i) => {
      if (y - leading < M + 18) newPage()
      y -= leading
      const total = ln.reduce((n, w, j) => n + w.w + (j < ln.length - 1 ? w.space : 0), 0)
      let x = opts.center ? left + (width - total) / 2 : left + (i === 0 ? (opts.indent ?? 0) : 0)
      for (const w of ln) {
        page.drawText(w.text, { x, y, size, font: w.font, color: ink })
        x += w.w + w.space
      }
    })
  }

  // Title page.
  y = H * 0.62
  drawRuns([{ text: doc.title, bold: true }], 24, 30, { center: true })
  if (doc.subtitle) drawRuns([{ text: doc.subtitle, italic: true }], 14, 20, { center: true })
  if (doc.author) {
    y -= 12
    drawRuns([{ text: `by ${doc.author}` }], 13, 18, { center: true })
  }
  if (doc.description) {
    y -= 24
    drawRuns([{ text: doc.description }], 10, 14, { center: true })
  }

  for (const s of doc.sections) {
    newPage()
    y = H - M - 70
    drawRuns([{ text: s.title, bold: true }], 17, 22, { center: true })
    y -= 22
    let first = true
    for (const b of s.blocks) {
      if (b.kind === 'heading') {
        y -= 8
        if (y < M + 80) newPage()
        drawRuns([{ text: b.text, bold: true, italic: b.level === 3 }], b.level === 2 ? 13 : 11.5, 18)
        y -= 2
        first = true
      } else if (b.kind === 'break') {
        y -= 6
        drawRuns([{ text: '* * *' }], 11, 18, { center: true })
        y -= 6
        first = true
      } else if (b.style === 'meta') {
        drawRuns(b.runs, 10, 14)
        y -= 3
      } else if (b.style === 'quote') {
        drawRuns(
          b.runs.map((r) => ({ ...r, italic: true })),
          10.5,
          15,
          { left: 18 },
        )
        y -= 4
      } else {
        drawRuns(b.runs, 11, 15.5, { indent: first ? 0 : 18 })
        first = false
      }
    }
  }

  // Page numbers, skipping the title page.
  pages.forEach((pg, i) => {
    if (i === 0) return
    const label = String(i)
    pg.drawText(label, { x: W / 2 - F.regular.widthOfTextAtSize(label, 9) / 2, y: M / 2, size: 9, font: F.regular, color: rgb(0.35, 0.35, 0.4) })
  })
  return pdf.save()
}

export async function render(doc: ExportDoc, format: Format, id: string): Promise<Uint8Array> {
  if (format === 'txt') return new TextEncoder().encode(toTxt(doc))
  if (format === 'md') return new TextEncoder().encode(toMd(doc))
  if (format === 'docx') return toDocx(doc)
  if (format === 'epub') return toEpub(doc, id)
  return toPdf(doc)
}
