// Builds small but real DOCX, EPUB and PDF files for extraction tests.
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type DocxPara = { style?: 'Heading1' | 'Heading2' | 'Title'; runs: Array<{ text: string; b?: boolean; i?: boolean }> }

export async function makeDocx(paras: DocxPara[]): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  )
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>`,
  )
  const body = paras
    .map((p) => {
      const pPr = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''
      const runs = p.runs
        .map((r) => `<w:r>${r.b || r.i ? `<w:rPr>${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`)
        .join('')
      return `<w:p>${pPr}${runs}</w:p>`
    })
    .join('')
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}

export async function makeEpub(title: string, chapters: Array<{ heading?: string; paragraphs: string[]; file?: string }>, extra?: (zip: JSZip) => void): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  const items = chapters.map((c, i) => ({ id: `c${i}`, href: c.file ?? `text/ch${i + 1}.xhtml`, c }))
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${items
      .map((it) => `<item id="${it.id}" href="${it.href}" media-type="application/xhtml+xml"/>`)
      .join('')}</manifest><spine><itemref idref="nav"/>${items.map((it) => `<itemref idref="${it.id}"/>`).join('')}</spine></package>`,
  )
  zip.file('OEBPS/nav.xhtml', '<html><body><nav><ol><li>Table of contents should be skipped</li></ol></nav></body></html>')
  for (const it of items) {
    zip.file(
      `OEBPS/${it.href}`,
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{color:red}</style><script>alert(1)</script></head><body>${
        it.c.heading ? `<h1>${esc(it.c.heading)}</h1>` : ''
      }${it.c.paragraphs.map((p) => `<p>${p}</p>`).join('')}</body></html>`,
    )
  }
  extra?.(zip)
  return zip.generateAsync({ type: 'uint8array' })
}

export async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  for (const lines of pages) {
    const page = pdf.addPage([400, 600])
    let y = 560
    for (const line of lines) {
      if (line) page.drawText(line, { x: 40, y, size: 11, font })
      y -= 16
    }
  }
  return pdf.save()
}

export async function makeBlankPdf(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) pdf.addPage([400, 600])
  return pdf.save()
}

/**
 * A Word file shaped like a print layout converted to DOCX (the common "PDF to Word"
 * output): running headers and page numbers as body paragraphs, paragraphs cut at
 * page ends, line-end hyphenation turned into spaces, a drop-cap frame whose first
 * line sits in a text box (DrawingML with a VML fallback), and a table.
 */
export async function makeConvertedDocx(): Promise<Uint8Array> {
  const p = (text: string, extra = '') => `<w:p>${extra}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
  const h1 = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${esc(text)}</w:t></w:r></w:p>`
  const txbx = (text: string) => `<w:txbxContent>${p(text)}</w:txbxContent>`
  const dropCapFrame = `<w:p><w:pPr><w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/></w:pPr><w:r><w:t>P</w:t></w:r></w:p>`
  const hostWithTextBox = `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx>${txbx(
    'eople were',
  )}</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox>${txbx(
    'eople were',
  )}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t xml:space="preserve">trying to find their way to their rooms. Lauren pulled her suitcase behind her.</w:t></w:r></w:p>`
  const body = [
    p('Soror Love'),
    p('Shaun J. Phree'),
    p('Published by PLE Press LLC, 2024.'),
    p('Copyright © 2024 by Shaun J. Phree'),
    p('All rights reserved.'),
    p('Also by Shaun J. Phree'),
    h1('Chapter 1'),
    dropCapFrame,
    hostWithTextBox,
    p('“Welcome to the hotel,” she said, catching the at tention of the clerk.'),
    p('1'),
    p('2 SHAUN J. PHREE'),
    p('The woman behind the table did not bother to look up at Lauren; she'),
    p('SOROR LOVE 3'),
    p('con tinued to swipe through her phone. Lauren moved swift ly through the room.'),
    `<w:tbl><w:tr><w:tc>${p('A letter was taped inside the drawer.')}</w:tc></w:tr></w:tbl>`,
    p('4 SHAUN J. PHREE'),
    p('Nobody mentioned the inci dents from last year. It was a part of the past.'),
    p('SOROR LOVE 5'),
    p('The sorority house was quiet. Everyone in the sorority had gone home.'),
    h1('Chapter 2'),
    p('Morning came early.'),
    p('6 SHAUN J. PHREE'),
  ].join('')
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  )
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
  )
  // A real header part, which must never be read into the text.
  zip.file('word/header1.xml', `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p('HEADER PART TEXT')}</w:hdr>`)
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}

/** A typeset PDF: running headers alternate title/author with page numbers at the outer edge, drop cap, hyphenation. */
export async function makeTypesetPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const W = 400
  const H = 600
  const body = 11
  const pages: Array<{ header: string; lines: Array<{ text: string; indent?: boolean; size?: number; x?: number; gapBefore?: number }> }> = [
    {
      header: '',
      lines: [
        { text: 'Chapter 1', size: 20, gapBefore: 60 },
        { text: 'P', size: 34, gapBefore: 30 },
        { text: 'eople were trying to find their way to their rooms.', x: 70 },
        { text: 'Lauren pulled her suitcase behind her and stopped at the', indent: true },
        { text: 'front desk, where a clerk looked up with polite inter-' },
        { text: 'est and a tired smile.' },
      ],
    },
    {
      header: '2 SHAUN J. PHREE',
      lines: [
        { text: 'The woman behind the table did not bother to look' },
        { text: 'up at Lauren; she kept swiping through her phone.' },
        { text: 'Lauren waited for a long, quiet moment before she', indent: true },
      ],
    },
    {
      header: 'SOROR LOVE 3',
      lines: [{ text: 'spoke again, and the whole lobby turned to listen.' }, { text: 'Nobody said a word.', indent: true }],
    },
  ]
  pages.forEach((pg, i) => {
    const page = pdf.addPage([W, H])
    if (pg.header) {
      const isEven = (i + 1) % 2 === 0
      const w = font.widthOfTextAtSize(pg.header, 9)
      page.drawText(pg.header, { x: isEven ? 40 : W - 40 - w, y: H - 40, size: 9, font })
    }
    let y = H - 80
    for (const l of pg.lines) {
      y -= l.gapBefore ?? 15
      page.drawText(l.text, { x: l.x ?? (l.indent ? 58 : 40), y, size: l.size ?? body, font })
    }
    page.drawText(String(i + 1), { x: W / 2 - 3, y: 30, size: 9, font })
  })
  return pdf.save()
}
