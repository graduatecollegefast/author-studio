// Server-side text extraction for DOCX, PDF, EPUB, TXT and Markdown.
// Manuscripts are untrusted input: we read text only, never execute or store
// embedded HTML, scripts, or links, and we cap sizes to avoid archive bombs.

import mammoth from 'mammoth'
import JSZip from 'jszip'
import { parse, type HTMLElement, type Node as HtmlNode } from 'node-html-parser'
import { extractText, getDocumentProxy } from 'unpdf'
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
/** Rebuild paragraphs from PDF page text and drop running headers, footers, and page numbers. */
export function blocksFromPdfPages(pages: string[]): Block[] {
  const pageLines = pages.map((p) =>
    p
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim()),
  )
  // Lines that repeat on many pages (book title, author name) are headers or footers.
  const freq = new Map<string, number>()
  for (const lines of pageLines) for (const l of new Set(lines)) if (l && l.length < 80) freq.set(l, (freq.get(l) ?? 0) + 1)
  const repeated = new Set([...freq].filter(([, n]) => pages.length >= 4 && n >= pages.length * 0.5).map(([l]) => l))

  const lines: string[] = []
  for (const pl of pageLines) {
    for (const l of pl) {
      if (repeated.has(l) || /^(page\s*)?\d{1,4}$/i.test(l)) continue
      lines.push(l)
    }
    lines.push('')
  }

  const lengths = lines.filter(Boolean).map((l) => l.length).sort((a, b) => a - b)
  const typical = lengths[Math.floor(lengths.length * 0.75)] ?? 60
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    let text = para.join(' ')
    text = text.replace(/(\w)- (\w)/g, '$1$2').replace(/\s+/g, ' ').trim()
    if (text) out.push(isSceneBreak(text) ? { kind: 'break' } : { kind: 'paragraph', runs: [{ text }] })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l) {
      // Page boundary or blank line: only end the paragraph if the sentence ended.
      if (para.length && /[.!?"'”’)\]:]$/.test(para[para.length - 1])) flush()
      continue
    }
    if (isSceneBreak(l)) {
      flush()
      out.push({ kind: 'break' })
      continue
    }
    if (/^(chapter|prologue|epilogue|part)\b/i.test(l) && l.length < 60) {
      flush()
      out.push({ kind: 'paragraph', runs: [{ text: l }] })
      continue
    }
    para.push(l)
    // A short line that ends a sentence usually ends the paragraph.
    if (l.length < typical * 0.8 && /[.!?"'”’)\]]$/.test(l)) flush()
  }
  flush()
  return out
}

export async function extractPdf(bytes: Uint8Array): Promise<{ blocks: Block[]; pageCount: number; needsOcr: boolean }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const chars = text.reduce((n, t) => n + t.replace(/\s/g, '').length, 0)
  // Scanned books have pages but almost no text layer.
  const needsOcr = totalPages > 0 && chars / totalPages < 40
  return { blocks: needsOcr ? [] : blocksFromPdfPages(text), pageCount: totalPages, needsOcr }
}

// ---------------------------------------------------------------------------
export async function extractManuscript(ext: ExtractionResult['format'], bytes: Uint8Array): Promise<ExtractionResult> {
  switch (ext) {
    case 'txt':
      return summarize('txt', null, splitIntoChapters(extractTxt(bytes)), null, [])
    case 'md':
      return summarize('md', null, splitIntoChapters(extractMarkdown(bytes)), null, [])
    case 'docx': {
      const { blocks, warnings } = await extractDocx(bytes)
      return summarize('docx', null, splitIntoChapters(blocks), null, warnings)
    }
    case 'epub': {
      const { blocks, title, warnings } = await extractEpub(bytes)
      return summarize('epub', title, splitIntoChapters(blocks), null, warnings)
    }
    case 'pdf': {
      const { blocks, pageCount, needsOcr } = await extractPdf(bytes)
      const warnings = needsOcr
        ? ['This PDF has little or no selectable text. It looks scanned and needs OCR before its words can be read.']
        : ['PDF layout does not store paragraphs, so paragraph breaks were reconstructed. Check the import preview.']
      return summarize('pdf', null, needsOcr ? [] : splitIntoChapters(blocks), pageCount, warnings, needsOcr)
    }
  }
}
