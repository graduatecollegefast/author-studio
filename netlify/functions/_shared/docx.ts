// Direct DOCX reader. Reads word/document.xml in document order, including
// text boxes, tables, content controls and drop-cap frames, which converted
// print layouts (PDF to Word) rely on. Headers and footers live in separate
// parts and are never read. Only text, bold, italic and structure are kept.

import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import type { Block, Run } from '../../../src/lib/documents/structure'

type XNode = Record<string, unknown>

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  processEntities: true,
  htmlEntities: true,
  parseTagValue: false,
})

const MAX_DOCX_UNCOMPRESSED = 300 * 1024 * 1024

function tagOf(n: XNode): string | null {
  for (const k of Object.keys(n)) if (k !== ':@') return k
  return null
}
function kids(n: XNode): XNode[] {
  const t = tagOf(n)
  const v = t ? n[t] : undefined
  return Array.isArray(v) ? (v as XNode[]) : []
}
function attr(n: XNode, name: string): string | undefined {
  const a = n[':@'] as Record<string, string> | undefined
  return a?.[name]
}
function find(n: XNode, tag: string): XNode | undefined {
  return kids(n).find((c) => tagOf(c) === tag)
}
function isOn(n: XNode | undefined): boolean {
  if (!n) return false
  const v = attr(n, 'w:val')
  return v === undefined || !['0', 'false', 'off', 'none'].includes(v)
}

interface Para {
  runs: Run[]
  style: string | null
  outline: number | null
  dropCap: boolean
  pageBreakBefore: boolean
}

export interface DocxBlocks {
  blocks: Block[]
  /** Indexes in `blocks` where a page break was recorded (helps rejoin split paragraphs). */
  pageBreaks: Set<number>
  dropCapIndexes: Set<number>
}

function headingLevel(p: Para, styles: Map<string, { name: string; basedOn?: string; outline?: number }>): number | null {
  if (p.outline !== null && p.outline <= 2) return p.outline + 1
  let id = p.style
  for (let depth = 0; id && depth < 6; depth++) {
    const s = styles.get(id)
    if (!s) break
    const m = /^heading\s*([1-6])$/i.exec(s.name)
    if (m) return Number(m[1])
    if (/^title$/i.test(s.name)) return 1
    if (s.outline !== undefined && s.outline <= 2) return s.outline + 1
    id = s.basedOn ?? null
  }
  return null
}

function readStyles(xml: string | undefined) {
  const map = new Map<string, { name: string; basedOn?: string; outline?: number }>()
  if (!xml) return map
  const root = parser.parse(xml) as XNode[]
  const stylesEl = root.find((n) => tagOf(n) === 'w:styles')
  for (const s of stylesEl ? kids(stylesEl) : []) {
    if (tagOf(s) !== 'w:style') continue
    const id = attr(s, 'w:styleId')
    if (!id) continue
    const name = attr(find(s, 'w:name') ?? {}, 'w:val') ?? id
    const basedOn = attr(find(s, 'w:basedOn') ?? {}, 'w:val')
    const ppr = find(s, 'w:pPr')
    const ol = ppr ? find(ppr, 'w:outlineLvl') : undefined
    map.set(id, { name, basedOn, outline: ol ? Number(attr(ol, 'w:val')) : undefined })
  }
  return map
}

export async function readDocx(bytes: Uint8Array): Promise<DocxBlocks> {
  const zip = await JSZip.loadAsync(bytes)
  const declared = Object.values(zip.files).reduce(
    (n, f) => n + ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
    0,
  )
  if (declared > MAX_DOCX_UNCOMPRESSED) throw new Error('This document expands to more than 300 MB and was not processed.')
  const docXml = await zip.file('word/document.xml')?.async('string')
  if (!docXml) throw new Error('This is not a Word document (word/document.xml is missing).')
  const styles = readStyles(await zip.file('word/styles.xml')?.async('string'))

  const paras: Para[] = []
  let pendingPageBreak = false

  const readRunProps = (r: XNode, inherited: { bold?: boolean; italic?: boolean }) => {
    const rpr = find(r, 'w:rPr')
    const bold = rpr && find(rpr, 'w:b') ? isOn(find(rpr, 'w:b')) : inherited.bold
    const italic = rpr && find(rpr, 'w:i') ? isOn(find(rpr, 'w:i')) : inherited.italic
    return { bold, italic }
  }

  // Text boxes found inside a paragraph are emitted as their own paragraphs, before the host paragraph.
  const boxes: XNode[][] = []

  const collectRuns = (n: XNode, marks: { bold?: boolean; italic?: boolean }, out: Run[]) => {
    for (const c of kids(n)) {
      const tag = tagOf(c)
      switch (tag) {
        case 'w:r': {
          const m = readRunProps(c, marks)
          for (const rc of kids(c)) {
            const t = tagOf(rc)
            if (t === 'w:t') {
              const text = kids(rc)
                .map((x) => String((x as Record<string, unknown>)['#text'] ?? ''))
                .join('')
              if (text) out.push({ text, ...(m.bold ? { bold: true } : {}), ...(m.italic ? { italic: true } : {}) })
            } else if (t === 'w:tab' || t === 'w:ptab') out.push({ text: ' ' })
            else if (t === 'w:br' || t === 'w:cr') {
              if (attr(rc, 'w:type') === 'page') pendingPageBreak = true
              else out.push({ text: ' ' })
            } else if (t === 'w:noBreakHyphen') out.push({ text: '-' })
            else if (t === 'w:softHyphen') out.push({ text: '­' })
            else if (t === 'w:drawing' || t === 'w:pict' || t === 'mc:AlternateContent' || t === 'w:object') collectBoxes(rc)
          }
          break
        }
        case 'w:hyperlink':
        case 'w:ins':
        case 'w:smartTag':
        case 'w:fldSimple':
        case 'w:customXml':
        case 'w:dir':
        case 'w:bdo':
          collectRuns(c, marks, out)
          break
        case 'w:sdt': {
          const content = find(c, 'w:sdtContent')
          if (content) collectRuns(content, marks, out)
          break
        }
        case 'mc:AlternateContent':
          collectBoxes(c)
          break
        default:
          // w:del, w:moveFrom, comments, bookmarks and field codes are not text.
          break
      }
    }
  }

  // Find text boxes. In mc:AlternateContent read only one branch (Choice, else Fallback) so text is not duplicated.
  const collectBoxes = (n: XNode) => {
    const tag = tagOf(n)
    if (tag === 'mc:AlternateContent') {
      const branch = find(n, 'mc:Choice') ?? find(n, 'mc:Fallback')
      if (branch) collectBoxes(branch)
      return
    }
    if (tag === 'w:txbxContent') {
      boxes.push(kids(n))
      return
    }
    for (const c of kids(n)) collectBoxes(c)
  }

  const readParagraph = (p: XNode) => {
    const ppr = find(p, 'w:pPr')
    const styleId = ppr ? attr(find(ppr, 'w:pStyle') ?? {}, 'w:val') ?? null : null
    const ol = ppr ? find(ppr, 'w:outlineLvl') : undefined
    const frame = ppr ? find(ppr, 'w:framePr') : undefined
    const dropCap = !!frame && ['drop', 'margin'].includes(attr(frame, 'w:dropCap') ?? '')
    if (ppr && find(ppr, 'w:pageBreakBefore') && isOn(find(ppr, 'w:pageBreakBefore'))) pendingPageBreak = true
    if (ppr && find(ppr, 'w:sectPr')) pendingPageBreak = true

    const runs: Run[] = []
    const boxStart = boxes.length
    collectRuns(p, {}, runs)
    // Paragraphs from text boxes anchored here come first (drop caps, first lines, pull quotes).
    const anchored = boxes.splice(boxStart)
    for (const box of anchored) for (const child of box) walk(child)

    paras.push({
      runs,
      style: styleId,
      outline: ol ? Number(attr(ol, 'w:val')) : null,
      dropCap,
      pageBreakBefore: pendingPageBreak,
    })
    pendingPageBreak = false
  }

  const walk = (n: XNode) => {
    const tag = tagOf(n)
    if (tag === 'w:p') readParagraph(n)
    else if (tag === 'w:tbl' || tag === 'w:tr' || tag === 'w:tc' || tag === 'w:body' || tag === 'w:sdtContent' || tag === 'w:customXml')
      for (const c of kids(n)) walk(c)
    else if (tag === 'w:sdt') {
      const content = find(n, 'w:sdtContent')
      if (content) walk(content)
    } else if (tag === 'mc:AlternateContent') {
      const branch = find(n, 'mc:Choice') ?? find(n, 'mc:Fallback')
      if (branch) for (const c of kids(branch)) walk(c)
    }
  }

  const root = parser.parse(docXml) as XNode[]
  const doc = root.find((n) => tagOf(n) === 'w:document')
  const body = doc ? find(doc, 'w:body') : undefined
  if (!body) throw new Error('This Word document has no body.')
  walk(body)

  const blocks: Block[] = []
  const pageBreaks = new Set<number>()
  const dropCapIndexes = new Set<number>()
  for (const p of paras) {
    const runs = normalize(p.runs)
    const text = runs.map((r) => r.text).join('')
    if (p.pageBreakBefore) pageBreaks.add(blocks.length)
    if (!text) continue
    const level = headingLevel(p, styles)
    if (level !== null) blocks.push({ kind: 'heading', level, text })
    else {
      if (p.dropCap) dropCapIndexes.add(blocks.length)
      blocks.push({ kind: 'paragraph', runs })
    }
  }
  return { blocks, pageBreaks, dropCapIndexes }
}

function normalize(runs: Run[]): Run[] {
  const merged: Run[] = []
  for (const r of runs) {
    const text = r.text.replace(/[ \s]+/g, ' ')
    const prev = merged[merged.length - 1]
    if (prev && !!prev.bold === !!r.bold && !!prev.italic === !!r.italic) prev.text += text
    else merged.push({ ...r, text })
  }
  if (merged.length) {
    merged[0].text = merged[0].text.replace(/^\s+/, '')
    merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/\s+$/, '')
  }
  return merged.filter((r) => r.text.length > 0)
}
