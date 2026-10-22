// Server-side text extraction for DOCX, PDF, EPUB, TXT and Markdown.
// Manuscripts are untrusted input: we read text only, never execute or store
// embedded HTML, scripts, or links, and we cap sizes to avoid archive bombs.

import mammoth from 'mammoth'
import JSZip from 'jszip'
import { parse, type HTMLElement, type Node as HtmlNode } from 'node-html-parser'
import { getDocumentProxy } from 'unpdf'
import { readDocx } from './docx'
import { cleanupBlocks, looksLikeFrontMatter } from './cleanup'
import {
  isSceneBreak,
  splitIntoChapters,
  summarize,
  type Block,
  type ExtractionResult,
  type Run,
} from '../../../src/lib/documents/structure'

const MAX_EPUB_UNCOMPRESSED = 300 * 1024 * 1024
const MAX_EPUB_ENTRIES = 5000

export class ExtractionError extends Error {}

// ---------------------------------------------------------------------------
// Plain text and Markdown
// ---------------------------------------------------------------------------
// Windows-1252 bytes 0x80-0x9F (curly quotes, dashes, ellipsis). Some runtimes decode them as Latin-1 controls.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'

export function decodeText(bytes: Uint8Array): string {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start))
  } catch {
    let out = ''
    for (const b of bytes) out += b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] : String.fromCharCode(b)
    return out
  }
}

function paragraphsFromText(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ')
  // Blank-line separated paragraphs are the norm; fall back to one paragraph per line.
  const byBlank = normalized.split(/\n\s*\n/)
  const parts = byBlank.length > 1 ? byBlank.map((p) => p.replace(/\s*\n\s*/g, ' ')) : normalized.split('\n')
  return parts.map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
}

export function extractTxt(bytes: Uint8Array): Block[] {
  const lines = decodeText(bytes).replace(/\r\n?/g, '\n')
  // Keep single-line scene breaks and chapter lines separate even inside paragraphs.
  const out: Block[] = []
  for (const para of paragraphsFromText(lines)) {
    if (isSceneBreak(para)) out.push({ kind: 'break' })
    else out.push({ kind: 'paragraph', runs: [{ text: para }] })
  }
  return out
}

/** Minimal Markdown inline parsing: **bold**, __bold__, *italic*, _italic_. Everything else is literal text. */
export function parseInlineMarkdown(text: string): Run[] {
  const runs: Run[] = []
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) runs.push({ text: text.slice(last, m.index) })
    if (m[1]) runs.push({ text: m[2], bold: true })
    else runs.push({ text: m[4], italic: true })
    last = m.index! + m[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs.map((r) => ({ ...r, text: r.text.replace(/\\([*_#`])/g, '$1') }))
}

export function extractMarkdown(bytes: Uint8Array): Block[] {
  const text = decodeText(bytes).replace(/\r\n?/g, '\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) {
      const joined = para.join(' ').replace(/\s+/g, ' ').trim()
      if (joined) out.push({ kind: 'paragraph', runs: parseInlineMarkdown(joined) })
    }
    para = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
    if (!line) {
      flush()
    } else if (heading) {
      flush()
      out.push({ kind: 'heading', level: heading[1].length, text: heading[2].replace(/[*_]/g, '') })
    } else if (isSceneBreak(line) || /^_{3,}$/.test(line)) {
      flush()
      out.push({ kind: 'break' })
    } else {
      para.push(line.replace(/^>\s?/, '').replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, ''))
    }
  }
  flush()
  return out
}

// ---------------------------------------------------------------------------
// HTML (from DOCX via mammoth, and EPUB chapters)
// ---------------------------------------------------------------------------
const BLOCK_TAGS = new Set(['p', 'div', 'li', 'blockquote', 'section', 'article', 'pre'])
const SKIP_TAGS = new Set(['script', 'style', 'head', 'nav', 'aside', 'figure', 'img', 'svg', 'table', 'sup', 'math'])

function collectRuns(node: HtmlNode, marks: { bold?: boolean; italic?: boolean }, runs: Run[]) {
  if (node.nodeType === 3) {
    const text = node.rawText ? decodeEntities(node.rawText) : ''
    if (text) runs.push({ text, ...(marks.bold ? { bold: true } : {}), ...(marks.italic ? { italic: true } : {}) })
    return
  }
  if (node.nodeType !== 1) return
  const el = node as HTMLElement
  const tag = el.rawTagName?.toLowerCase() ?? ''
  if (SKIP_TAGS.has(tag)) return
  if (tag === 'br') {
    runs.push({ text: ' ' })
    return
  }
  const next = {
    bold: marks.bold || tag === 'strong' || tag === 'b',
    italic: marks.italic || tag === 'em' || tag === 'i' || tag === 'cite',
  }
  for (const child of el.childNodes) collectRuns(child, next, runs)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
}

function normalizeRuns(runs: Run[]): Run[] {
  const merged: Run[] = []
  for (const r of runs) {
    const text = r.text.replace(/\s+/g, ' ')
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

export function blocksFromHtml(html: string): Block[] {
  const root = parse(html, { lowerCaseTagName: true, comment: false, blockTextElements: { script: false, style: false, pre: true } })
  const body = root.querySelector('body') ?? root
  const out: Block[] = []

  const walk = (el: HTMLElement) => {
    for (const child of el.childNodes) {
      if (child.nodeType !== 1) {
        const t = child.nodeType === 3 ? decodeEntities(child.rawText).trim() : ''
        if (t) out.push({ kind: 'paragraph', runs: [{ text: t }] })
        continue
      }
      const c = child as HTMLElement
      const tag = c.rawTagName?.toLowerCase() ?? ''
      if (SKIP_TAGS.has(tag)) continue
      const h = /^h([1-6])$/.exec(tag)
      if (h) {
        const text = decodeEntities(c.textContent).replace(/\s+/g, ' ').trim()
        if (text) out.push({ kind: 'heading', level: Number(h[1]), text })
      } else if (tag === 'hr') {
        out.push({ kind: 'break' })
      } else if (BLOCK_TAGS.has(tag) || tag === 'ul' || tag === 'ol' || tag === 'body' || tag === 'main') {
        const hasBlockChildren = c.childNodes.some(
          (n) => n.nodeType === 1 && (BLOCK_TAGS.has((n as HTMLElement).rawTagName?.toLowerCase()) || /^h[1-6]$|^hr$|^ul$|^ol$/.test((n as HTMLElement).rawTagName?.toLowerCase() ?? '')),
        )
        if (hasBlockChildren) {
          walk(c)
        } else {
          const runs: Run[] = []
          collectRuns(c, {}, runs)
          const clean = normalizeRuns(runs)
          const text = clean.map((r) => r.text).join('')
          if (!text) continue
          if (isSceneBreak(text)) out.push({ kind: 'break' })
          else out.push({ kind: 'paragraph', runs: clean })
        }
      } else {
        walk(c)
      }
    }
  }
  walk(body as HTMLElement)
  return out
}

export async function extractDocx(bytes: Uint8Array): Promise<{ blocks: Block[]; warnings: string[] }> {
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    {
      // Images are dropped: only the words are needed.
      convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => p:fresh"],
    },
  )
  const warnings = result.messages.filter((m) => m.type === 'error').map((m) => m.message.slice(0, 200))
  return { blocks: blocksFromHtml(result.value), warnings }
}

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------
function resolvePath(base: string, href: string): string {
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '').concat(decodeURIComponent(href.split('#')[0])).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

export async function extractEpub(bytes: Uint8Array): Promise<{ blocks: Block[]; title: string | null; warnings: string[] }> {
  const zip = await JSZip.loadAsync(bytes)
  const entries = Object.values(zip.files)
  if (entries.length > MAX_EPUB_ENTRIES) throw new ExtractionError('This EPUB contains too many files to process safely.')
  // jszip exposes declared sizes; refuse archives that would expand too far.
  const declared = entries.reduce((n, f) => n + ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0)
  if (declared > MAX_EPUB_UNCOMPRESSED) throw new ExtractionError('This EPUB expands to more than 300 MB and was not processed.')

  const container = await zip.file('META-INF/container.xml')?.async('string')
  if (!container) throw new ExtractionError('This EPUB is missing its container file.')
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1]
  const opf = opfPath ? await zip.file(opfPath)?.async('string') : null
  if (!opf || !opfPath) throw new ExtractionError('This EPUB is missing its package file.')

  const doc = parse(opf, { lowerCaseTagName: true })
  const title = doc.querySelector('dc\\:title')?.textContent?.trim() || doc.querySelector('title')?.textContent?.trim() || null
  const manifest = new Map<string, { href: string; type: string; props: string }>()
  for (const item of doc.querySelectorAll('item')) {
    manifest.set(item.getAttribute('id') ?? '', {
      href: item.getAttribute('href') ?? '',
      type: item.getAttribute('media-type') ?? '',
      props: item.getAttribute('properties') ?? '',
    })
  }
  const blocks: Block[] = []
  const warnings: string[] = []
  for (const ref of doc.querySelectorAll('itemref')) {
    if (ref.getAttribute('linear') === 'no') continue
    const item = manifest.get(ref.getAttribute('idref') ?? '')
    if (!item || !/html|xml/.test(item.type) || item.props.includes('nav')) continue
    if (/(^|\/)(toc|nav|cover|copyright|titlepage)[^/]*\.x?html?$/i.test(item.href)) continue
    const path = resolvePath(opfPath, item.href)
    const html = await zip.file(path)?.async('string')
    if (!html) {
      warnings.push(`Missing section ${item.href}`)
      continue
    }
    const section = blocksFromHtml(html)
    // Each spine document usually starts a chapter; if it has no heading, mark the boundary with a break.
    if (blocks.length && section.length && section[0].kind !== 'heading') blocks.push({ kind: 'break' })
    blocks.push(...section)
  }
  return { blocks, title, warnings }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
interface PdfItem {
  str: string
  transform: number[]
  width: number
  height: number
}
interface PdfLine {
  text: string
  x0: number
  xEnd: number
  y: number
  size: number
}

/** Group positioned text items into reading-order lines (top to bottom, left to right). */
export function linesFromItems(items: PdfItem[]): PdfLine[] {
  const cleaned = items
    .filter((it) => it.str && it.str.trim() !== '')
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      size: Math.abs(it.height || it.transform[3] || 10),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Array<{ y: number; size: number; parts: typeof cleaned }> = []
  for (const it of cleaned) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, Math.min(l.size, it.size) * 0.5))
    if (line) {
      line.parts.push(it)
      line.size = Math.max(line.size, it.size)
    } else lines.push({ y: it.y, size: it.size, parts: [it] })
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const parts = l.parts.sort((a, b) => a.x - b.x)
      let text = ''
      let end = -Infinity
      for (const p of parts) {
        const gap = p.x - end
        if (text && gap > p.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(p.str)) text += ' '
        text += p.str
        end = p.x + p.w
      }
      return { text: text.replace(/\s+/g, ' ').trim(), x0: parts[0].x, xEnd: end, y: l.y, size: l.size }
    })
    .filter((l) => l.text)
}

const mode = (vals: number[]) => {
  const counts = new Map<number, number>()
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
}

/**
 * Rebuild paragraphs from positioned PDF lines. Uses font size for headings,
 * indents and vertical gaps for paragraph breaks, and treats the first and last
 * line of each page as possible running headers or footers for the cleanup pass.
 */
export function blocksFromPdfLines(pages: Array<{ lines: PdfLine[]; height: number }>): { blocks: Block[]; pageBreaks: Set<number>; dropCaps: number } {
  const all = pages.flatMap((p) => p.lines)
  const body = mode(all.flatMap((l) => Array(Math.min(l.text.length, 200)).fill(Math.round(l.size * 2) / 2))) || 11
  const bodyLines = all.filter((l) => Math.abs(l.size - body) < body * 0.15)
  const left = mode(bodyLines.map((l) => Math.round(l.x0)))
  const right = Math.max(...bodyLines.map((l) => l.xEnd), 0)
  const gaps: number[] = []
  for (const p of pages)
    for (let i = 1; i < p.lines.length; i++) {
      const g = p.lines[i - 1].y - p.lines[i].y
      if (g > 0 && g < body * 3) gaps.push(Math.round(g))
    }
  const leading = mode(gaps) || body * 1.3

  const blocks: Block[] = []
  const pageBreaks = new Set<number>()
  let para: string[] = []
  let dropCaps = 0
  let pendingDropCap = ''
  const flush = () => {
    const text = para.join(' ').replace(/\s+/g, ' ').trim()
    if (text) blocks.push(isSceneBreak(text) ? { kind: 'break' } : { kind: 'paragraph', runs: [{ text }] })
    para = []
  }
  const append = (t: string) => {
    if (pendingDropCap) {
      t = pendingDropCap + t
      pendingDropCap = ''
    }
    const last = para[para.length - 1]
    if (last && /[a-z]-$/.test(last) && /^[a-z]/.test(t)) para[para.length - 1] = last.slice(0, -1) + t
    else para.push(t)
  }

  for (const page of pages) {
    flush()
    pageBreaks.add(blocks.length)
    const lines = page.lines
    lines.forEach((l, i) => {
      const edge = (i === 0 && l.y > page.height * 0.85) || (i === lines.length - 1 && l.y < page.height * 0.12)
      const isFurnitureCandidate = edge && l.text.length < 90
      if (isFurnitureCandidate && (PAGE_NO.test(l.text) || l.size <= body * 1.05)) {
        // Emit as its own paragraph; the cleanup pass decides whether it is a header, footer or real text.
        const saved = para
        para = []
        blocks.push({ kind: 'paragraph', runs: [{ text: l.text }] })
        para = saved
        return
      }
      if (/^[A-Z]$/.test(l.text) && l.size > body * 1.8) {
        flush()
        pendingDropCap = l.text
        dropCaps++
        return
      }
      if (l.size > body * 1.25) {
        flush()
        blocks.push({ kind: 'heading', level: l.size > body * 1.6 ? 1 : 2, text: l.text })
        return
      }
      if (isSceneBreak(l.text)) {
        flush()
        blocks.push({ kind: 'break' })
        return
      }
      const prev = lines[i - 1]
      if (prev && para.length) {
        const gap = prev.y - l.y
        const indented = l.x0 > left + body * 0.8
        const prevShort = prev.xEnd < right - body * 2.5 && /[.!?"'”’)\]:]$/.test(prev.text)
        if (gap > leading * 1.5 || indented || prevShort) flush()
      }
      append(l.text)
    })
  }
  flush()
  return { blocks, pageBreaks, dropCaps }
}

const PAGE_NO = /^(?:page\s+)?\d{1,4}(?:\s+of\s+\d{1,4})?$/i

export async function extractPdf(bytes: Uint8Array): Promise<{ blocks: Block[]; pageBreaks: Set<number>; pageCount: number; needsOcr: boolean }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const pages: Array<{ lines: PdfLine[]; height: number }> = []
  let chars = 0
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const lines = linesFromItems(content.items as PdfItem[])
    chars += lines.reduce((c, l) => c + l.text.replace(/\s/g, '').length, 0)
    pages.push({ lines, height: viewport.height })
  }
  const needsOcr = pdf.numPages > 0 && chars / pdf.numPages < 40
  if (needsOcr) return { blocks: [], pageBreaks: new Set(), pageCount: pdf.numPages, needsOcr }
  const { blocks, pageBreaks } = blocksFromPdfLines(pages)
  return { blocks, pageBreaks, pageCount: pdf.numPages, needsOcr }
}

// ---------------------------------------------------------------------------
export interface ExtractOptions {
  /** Book title, pen name and author name, used to recognize running headers and footers. */
  knownStrings?: string[]
}

function finish(
  format: ExtractionResult['format'],
  title: string | null,
  blocks: Block[],
  opts: ExtractOptions,
  extra: { pageBreaks?: Set<number>; dropCapIndexes?: Set<number>; pageCount?: number | null; warnings?: string[] } = {},
): ExtractionResult {
  const known = [...(opts.knownStrings ?? []), ...(title ? [title] : [])]
  const { blocks: clean, report, warnings } = cleanupBlocks(blocks, {
    knownStrings: known,
    pageBreaks: extra.pageBreaks,
    dropCapIndexes: extra.dropCapIndexes,
  })
  const chapters = splitIntoChapters(clean)
  // Title page, copyright and "Also by" pages before the first chapter.
  if (chapters.length > 1 && !chapters[0].detected) {
    const text = chapters[0].scenes.map((s) => s.text).join(' ')
    if (looksLikeFrontMatter(text) || chapters[0].wordCount < 400) chapters[0] = { ...chapters[0], title: 'Front matter', frontMatter: true }
  }
  const result = summarize(format, title, chapters, extra.pageCount ?? null, [...(extra.warnings ?? []), ...warnings])
  result.cleanup = report
  return result
}

export async function extractManuscript(ext: ExtractionResult['format'], bytes: Uint8Array, opts: ExtractOptions = {}): Promise<ExtractionResult> {
  switch (ext) {
    case 'txt':
      return finish('txt', null, extractTxt(bytes), opts)
    case 'md':
      return finish('md', null, extractMarkdown(bytes), opts)
    case 'docx': {
      try {
        const { blocks, pageBreaks, dropCapIndexes } = await readDocx(bytes)
        if (blocks.some((b) => b.kind === 'paragraph')) return finish('docx', null, blocks, opts, { pageBreaks, dropCapIndexes })
      } catch (err) {
        if (err instanceof Error && /300 MB/.test(err.message)) throw new ExtractionError(err.message)
        // Fall back to the general converter below for unusual files.
      }
      const { blocks, warnings } = await extractDocx(bytes)
      return finish('docx', null, blocks, opts, { warnings })
    }
    case 'epub': {
      const { blocks, title, warnings } = await extractEpub(bytes)
      return finish('epub', title, blocks, opts, { warnings })
    }
    case 'pdf': {
      const { blocks, pageBreaks, pageCount, needsOcr } = await extractPdf(bytes)
      if (needsOcr) {
        return summarize('pdf', null, [], pageCount, ['This PDF has little or no selectable text. It looks scanned and needs OCR before its words can be read.'], true)
      }
      return finish('pdf', null, blocks, opts, {
        pageBreaks,
        pageCount,
        warnings: ['PDF files do not store paragraphs, so paragraph breaks were rebuilt from the page layout. Check the import preview.'],
      })
    }
  }
}
