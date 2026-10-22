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
