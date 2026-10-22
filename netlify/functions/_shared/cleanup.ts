// Removes print-layout debris from extracted manuscripts and repairs the text
// it broke: running headers and footers (book title, author name, page
// numbers), paragraphs split across pages, words split at line-end hyphens,
// and decorative drop-cap letters. Every change is counted and reported.

import { createRequire } from 'node:module'
import type { Block, Run } from '../../../src/lib/documents/structure'

const require = createRequire(import.meta.url)
let dictionary: Set<string> | null = null
function words(): Set<string> {
  if (!dictionary) dictionary = new Set(require('an-array-of-english-words') as string[])
  return dictionary
}

// Very common words. If both halves of a split are among these, the pair is
// probably real text ("a part", "any one"), so it is never joined.
const COMMON = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself one two three ten ever every any body thing way where time day side self less out over under up down back away along long short all ways`.split(
    /\s+/,
  ),
)

export interface CleanupOptions {
  /** Book title, pen name, author name: strings that appear in running headers. */
  knownStrings: string[]
  pageBreaks?: Set<number>
  dropCapIndexes?: Set<number>
}

export interface CleanupReport {
  runningHeadsRemoved: number
  pageNumbersRemoved: number
  paragraphsRejoined: number
  wordsRejoined: number
  dropCapsMerged: number
  dropCapsUnresolved: number
}

const key = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

// Dictionary entries that are really suffixes left over from a split word.
const SUFFIXES = new Set('ance ence ment ments ness tion tions sion sions ings ing ers ity ities ous ive able ible ally ful less ism ist ize ure ate ted ally edly ingly ward wards'.split(' '))

const PAGE_NUMBER = /^(?:[-–—(\[]\s*)?(?:page\s+)?(?:\d{1,4}|[ivxlc]{1,7})(?:\s+of\s+\d{1,4})?(?:\s*[-–—)\]])?$/i
const EDGE_NUMBER = /^\d{1,4}\s*(?:[|•·:–—-]\s*)?|\s*(?:[|•·:–—-]\s*)?\d{1,4}$/g

function textOf(b: Block): string {
  return b.kind === 'paragraph' ? b.runs.map((r) => r.text).join('') : b.kind === 'heading' ? b.text : ''
}

/** Is this paragraph a running header/footer or bare page number? */
export function classifyFurniture(
  text: string,
  known: string[],
  repeatCounts: Map<string, number>,
): 'page-number' | 'running-head' | null {
  const t = text.trim()
  if (!t || t.length > 90) return null
  if (PAGE_NUMBER.test(t)) return 'page-number'
  const core = t.replace(EDGE_NUMBER, '').trim()
  const hadNumber = core.length < t.length
  const k = key(core)
  if (!k) return hadNumber ? 'page-number' : null
  const isKnown = known.some((s) => s && (k === s || (k.length >= 4 && (k.includes(s) || s.includes(k)) && Math.abs(k.length - s.length) <= 12)))
  const repeats = repeatCounts.get(k) ?? 0
  // "SOROR LOVE 3", "2 SHAUN J. PHREE": a known string or a repeating short line, with a page number.
  if (hadNumber && (isKnown || repeats >= 3)) return 'running-head'
  // Title or author repeated on many pages without a number.
  if (!hadNumber && isKnown && repeats >= 5) return 'running-head'
  // An all-caps line without sentence punctuation repeated on many pages ("THE SALT LETTERS").
  if (!hadNumber && repeats >= 3 && core.length <= 60 && /[A-Z]/.test(core) && core === core.toUpperCase() && !/[.!?,;"“”]/.test(core))
    return 'running-head'
  return null
}

function endsSentence(text: string): boolean {
  return /[.!?…:;"”’)\]—]\s*$/.test(text.trim())
}

function joinRuns(a: Run[], b: Run[], glue: string): Run[] {
  const out = a.map((r) => ({ ...r }))
  const last = out[out.length - 1]
  if (glue === '' && last) last.text = last.text.replace(/-$/, '')
  else if (last && glue) last.text = last.text.replace(/\s+$/, '') + glue
  for (const r of b) {
    const prev = out[out.length - 1]
    if (prev && !!prev.bold === !!r.bold && !!prev.italic === !!r.italic) prev.text += r.text
    else out.push({ ...r })
  }
  return out
}

function shouldJoin(left: string, right: string, docWords: Map<string, number>, dict: Set<string>): boolean {
  const l = left.toLowerCase()
  if (COMMON.has(l) && COMMON.has(right)) return false
  const joined = l + right
  if (joined.length < 5) return false
  const inDict = dict.has(joined)
  const inDoc = (docWords.get(joined) ?? 0) >= 2
  if (!inDict && !inDoc) return false
  // Two-letter dictionary entries like "pa" or "ow" do not count as real words here.
  const leftWord = (dict.has(l) && (l.length >= 3 || COMMON.has(l))) || (docWords.get(l) ?? 0) >= 3
  const rightWord = dict.has(right) && !SUFFIXES.has(right) && (right.length >= 3 || COMMON.has(right))
  // A short uncommon prefix plus a word that makes a long word ("con sequences").
  const prefixSplit = !COMMON.has(l) && l.length <= 4 && joined.length >= 8 && inDict
  // Join when a half is not a real word, or the document itself uses the joined form.
  return !(leftWord && rightWord && !inDoc && !prefixSplit)
}

/** Join words broken by a line-end hyphen that a converter turned into a space ("inci dents"). */
export function rejoinSplitWords(text: string, docWords: Map<string, number>): { text: string; count: number } {
  const dict = words()
  let count = 0
  let out = text.replace(/­\s*/g, () => {
    count++
    return ''
  })
  // Walk word by word so overlapping pairs ("the inci dents") are all considered.
  const parts = out.split(/(\s+)/)
  for (let i = 0; i + 2 < parts.length; i += 2) {
    const left = parts[i]
    const right = parts[i + 2]
    if (parts[i + 1] !== ' ' || !/^[A-Za-z][a-z]*$/.test(left) || !/^[a-z]{2,}[.,;:!?”’"')]*$/.test(right)) continue
    const rightWordOnly = right.match(/^[a-z]+/)![0]
    const trailing = right.slice(rightWordOnly.length)
    if (shouldJoin(left, rightWordOnly, docWords, dict)) {
      parts.splice(i, 3, left + rightWordOnly + trailing)
      count++
      i -= 2 // the joined word may itself be the first half of another split
    }
  }
  out = parts.join('')
  return { text: out, count }
}

export function cleanupBlocks(input: Block[], opts: CleanupOptions): { blocks: Block[]; report: CleanupReport; warnings: string[] } {
  const report: CleanupReport = {
    runningHeadsRemoved: 0,
    pageNumbersRemoved: 0,
    paragraphsRejoined: 0,
    wordsRejoined: 0,
    dropCapsMerged: 0,
    dropCapsUnresolved: 0,
  }
  const known = opts.knownStrings.map(key).filter((s) => s.length >= 3)

  // Count short lines (with page numbers stripped) to find repeating headers.
  const repeatCounts = new Map<string, number>()
  for (const b of input) {
    const t = textOf(b).trim()
    if (!t || t.length > 90) continue
    const k = key(t.replace(EDGE_NUMBER, ''))
    if (k) repeatCounts.set(k, (repeatCounts.get(k) ?? 0) + 1)
  }

  // 1. Remove furniture, remembering where pages ended.
  const kept: Array<{ block: Block; afterBreak: boolean; dropCap: boolean }> = []
  let breakPending = false
  input.forEach((b, i) => {
    if (opts.pageBreaks?.has(i)) breakPending = true
    if (b.kind !== 'break') {
      const kind = classifyFurniture(textOf(b), known, repeatCounts)
      if (kind) {
        if (kind === 'page-number') report.pageNumbersRemoved++
        else report.runningHeadsRemoved++
        breakPending = true
        return
      }
    }
    kept.push({ block: b, afterBreak: breakPending, dropCap: !!opts.dropCapIndexes?.has(i) })
    breakPending = false
  })

  // Words used in the book (for rejoining split words and names).
  const docWords = new Map<string, number>()
  for (const { block } of kept)
    for (const w of textOf(block).toLowerCase().match(/[a-z]+/g) ?? []) docWords.set(w, (docWords.get(w) ?? 0) + 1)

  // 2. Drop caps and paragraphs split across pages.
  const out: Block[] = []
  const warnings: string[] = []
  const unresolvedDropCaps = new Set<Block>()
  for (let i = 0; i < kept.length; i++) {
    const { block, afterBreak } = kept[i]
    const prev = out[out.length - 1]

    if (block.kind === 'paragraph') {
      const text = textOf(block).trim()
      const isDropCap = kept[i].dropCap || /^[A-Z]$/.test(text)
      if (isDropCap && /^[A-Z]{1,2}$/.test(text)) {
        const next = kept[i + 1]?.block
        const nextText = next ? textOf(next) : ''
        const firstWord = (nextText.match(/^[a-z]+/) ?? [''])[0]
        const candidate = (text + firstWord).toLowerCase()
        if (next?.kind === 'paragraph' && firstWord && (words().has(candidate) || (docWords.get(candidate) ?? 0) >= 1)) {
          kept[i + 1] = { ...kept[i + 1], block: { kind: 'paragraph', runs: joinRuns(block.runs, next.runs, '') } }
          report.dropCapsMerged++
        } else if (next?.kind === 'paragraph' && nextText && !/^[a-z]/.test(nextText)) {
          // Next paragraph starts a new word: the letter begins it (e.g. "I" + " was").
          kept[i + 1] = { ...kept[i + 1], block: { kind: 'paragraph', runs: joinRuns(block.runs, next.runs, ' ') } }
          report.dropCapsMerged++
        } else {
          // The rest of the first line is missing from the file; keep the letter and say so.
          report.dropCapsUnresolved++
          unresolvedDropCaps.add(block)
          out.push(block)
        }
        continue
      }

      // A paragraph that starts in lowercase, or follows one that stopped mid-sentence
      // at a page boundary, is the second half of a paragraph split by the page.
      if (prev?.kind === 'paragraph' && !unresolvedDropCaps.has(prev)) {
        const prevText = textOf(prev)
        const startsLower = /^[a-z]/.test(text)
        const prevOpen = !endsSentence(prevText)
        if ((startsLower && (prevOpen || afterBreak)) || (afterBreak && prevOpen && /^[A-Za-z]/.test(text))) {
          const hyphen = /[a-z]-$/.test(prevText.trim()) && startsLower
          out[out.length - 1] = { kind: 'paragraph', runs: joinRuns(prev.runs, block.runs, hyphen ? '' : ' ') }
          report.paragraphsRejoined++
          continue
        }
      }
    }
    out.push(block)
  }

  // 3. Words split at line ends.
  const final = out.map((b) => {
    if (b.kind !== 'paragraph') return b
    const runs = b.runs.map((r) => {
      const { text, count } = rejoinSplitWords(r.text, docWords)
      report.wordsRejoined += count
      return { ...r, text }
    })
    return { kind: 'paragraph' as const, runs }
  })

  if (report.dropCapsUnresolved)
    warnings.push(
      `${report.dropCapsUnresolved} decorative first ${report.dropCapsUnresolved === 1 ? 'letter has' : 'letters have'} text missing after it in the file. Check the start of those chapters after importing.`,
    )
  return { blocks: final, report, warnings }
}

/** Title page, copyright, "Also by", dedication: material before the story starts. */
export function looksLikeFrontMatter(text: string): boolean {
  return /\b(copyright|©|all rights reserved|isbn|published by|printed in|also by|work of fiction|dedicated to|for more information|first edition|cover design)\b/i.test(
    text,
  )
}
