// Normalized manuscript structure shared by the extractor (server) and the
// import preview (browser). Pure functions only, so they are easy to test.

export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
}

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; runs: Run[] }
  | { kind: 'break' } // scene break

export interface ExtractedScene {
  blocks: Block[]
  text: string
  wordCount: number
}

export interface ExtractedChapter {
  title: string
  /** True when the title was found in the manuscript, false when we had to invent one. */
  detected: boolean
  /** Title page, copyright, "Also by" and similar material before the story. Not imported by default. */
  frontMatter?: boolean
  scenes: ExtractedScene[]
  wordCount: number
}

export interface CleanupSummary {
  runningHeadsRemoved: number
  pageNumbersRemoved: number
  paragraphsRejoined: number
  wordsRejoined: number
  dropCapsMerged: number
  dropCapsUnresolved: number
}

export interface ExtractionResult {
  format: 'docx' | 'pdf' | 'epub' | 'txt' | 'md'
  title: string | null
  chapters: ExtractedChapter[]
  wordCount: number
  characterCount: number
  pageCount: number | null
  warnings: string[]
  needsOcr: boolean
  cleanup?: CleanupSummary
}

export interface Chunk {
  index: number
  chapterLabel: string
  content: string
  charStart: number
  charEnd: number
  tokenEstimate: number
}

const SCENE_BREAK = /^\s*(?:\*\s*){3,}\s*$|^\s*(?:#\s*){1,3}\s*$|^\s*(?:~\s*){3,}\s*$|^\s*(?:-\s*){3,}\s*$|^\s*(?:•\s*){3,}\s*$|^\s*§\s*$/

const NUMBER_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty'
const CHAPTER_LINE = new RegExp(
  `^\\s*(?:chapter|ch\\.)\\s+(?:\\d{1,3}|[ivxlcdm]{1,7}|(?:${NUMBER_WORDS})(?:[\\s-](?:${NUMBER_WORDS}))?)\\b[\\s.:\\-–—]*.{0,80}$|^\\s*(?:prologue|epilogue|interlude|afterword|foreword|preface|introduction)\\b.{0,60}$|^\\s*part\\s+(?:\\d{1,2}|[ivxlc]{1,5}|${NUMBER_WORDS})\\b.{0,60}$`,
  'i',
)

export function runsText(runs: Run[]): string {
  return runs.map((r) => r.text).join('')
}

export function isSceneBreak(text: string): boolean {
  return SCENE_BREAK.test(text)
}

export function looksLikeChapterHeading(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 90) return false
  return CHAPTER_LINE.test(t)
}

export function countWords(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

function blockText(b: Block): string {
  if (b.kind === 'paragraph') return runsText(b.runs)
  if (b.kind === 'heading') return b.text
  return ''
}

function finishScene(blocks: Block[]): ExtractedScene | null {
  const content = blocks.filter((b) => b.kind !== 'break')
  if (!content.some((b) => blockText(b).trim())) return null
  const text = content.map(blockText).join('\n\n')
  return { blocks: content, text, wordCount: countWords(text) }
}

/**
 * Turn a flat list of blocks into chapters and scenes.
 * Chapter boundaries: headings (level 1 or 2), or paragraphs that read like
 * chapter titles ("Chapter 12", "CHAPTER TWELVE: The Ferry", "Prologue").
 * Scene boundaries: explicit breaks ("* * *", "#", horizontal rules).
 * Text before the first chapter becomes "Opening" only if it is substantial.
 */
export function splitIntoChapters(blocks: Block[]): ExtractedChapter[] {
  const chapters: ExtractedChapter[] = []
  let title: string | null = null
  let detected = false
  let scenes: ExtractedScene[] = []
  let current: Block[] = []

  const closeScene = () => {
    const s = finishScene(current)
    if (s) scenes.push(s)
    current = []
  }
  const closeChapter = () => {
    closeScene()
    if (scenes.length) {
      const wordCount = scenes.reduce((n, s) => n + s.wordCount, 0)
      chapters.push({ title: title ?? 'Opening', detected: title !== null && detected, scenes, wordCount })
    }
    scenes = []
  }

  // Use headings as chapter markers only if the document has some; otherwise fall back to text patterns.
  const headingLevels = blocks.filter((b) => b.kind === 'heading').map((b) => (b as { level: number }).level)
  const chapterLevel = headingLevels.length ? Math.min(...headingLevels.filter((l) => l <= 2), 99) : 99

  for (const b of blocks) {
    if (b.kind === 'break') {
      closeScene()
      continue
    }
    const text = blockText(b).trim()
    if (b.kind === 'paragraph' && isSceneBreak(text)) {
      closeScene()
      continue
    }
    const isHeadingChapter = b.kind === 'heading' && b.level <= chapterLevel
    const isPatternChapter = b.kind === 'paragraph' && looksLikeChapterHeading(text) && b.runs.length <= 3
    if (isHeadingChapter || isPatternChapter || (b.kind === 'heading' && looksLikeChapterHeading(text))) {
      closeChapter()
      title = text.replace(/\s+/g, ' ').slice(0, 200)
      detected = true
      continue
    }
    if (b.kind === 'heading') {
      // Lower-level headings inside a chapter are kept as headings in the text.
      current.push(b)
      continue
    }
    current.push(b)
  }
  closeChapter()

  // A tiny unlabeled opening (title page, dedication) is not a chapter.
  if (chapters.length > 1 && chapters[0].title === 'Opening' && chapters[0].wordCount < 150) chapters.shift()

  // No structure found at all: one chapter for the whole text.
  if (chapters.length === 1 && !chapters[0].detected) chapters[0] = { ...chapters[0], title: 'Chapter 1' }
  return chapters
}

/** Convert extracted blocks to TipTap JSON for the editor. Only plain text, bold and italic survive. */
export function blocksToTiptap(blocks: Block[]): { type: 'doc'; content: Array<Record<string, unknown>> } {
  const content: Array<Record<string, unknown>> = []
  for (const b of blocks) {
    if (b.kind === 'break') {
      content.push({ type: 'horizontalRule' })
    } else if (b.kind === 'heading') {
      content.push({ type: 'heading', attrs: { level: Math.min(3, Math.max(2, b.level)) }, content: [{ type: 'text', text: b.text }] })
    } else {
      const nodes = b.runs
        .filter((r) => r.text.length > 0)
        .map((r) => {
          const marks = [r.bold && { type: 'bold' }, r.italic && { type: 'italic' }].filter(Boolean)
          return marks.length ? { type: 'text', text: r.text, marks } : { type: 'text', text: r.text }
        })
      content.push(nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' })
    }
  }
  if (!content.length) content.push({ type: 'paragraph' })
  return { type: 'doc', content }
}

/** Plain manuscript text with chapter titles, used for chunking and search. */
export function chaptersToPlainText(chapters: ExtractedChapter[]): { text: string; chapterStarts: Array<{ title: string; start: number }> } {
  let text = ''
  const chapterStarts: Array<{ title: string; start: number }> = []
  for (const c of chapters) {
    if (text) text += '\n\n'
    chapterStarts.push({ title: c.title, start: text.length })
    text += c.title + '\n\n' + c.scenes.map((s) => s.text).join('\n\n* * *\n\n')
  }
  return { text, chapterStarts }
}

/**
 * Split text into overlapping-free chunks on paragraph boundaries, recording
 * exact character offsets so later analysis can cite source locations.
 */
export function buildChunks(chapters: ExtractedChapter[], targetChars = 6000): Chunk[] {
  const { text, chapterStarts } = chaptersToPlainText(chapters)
  const chunks: Chunk[] = []
  const labelAt = (pos: number) => {
    let label = chapterStarts[0]?.title ?? ''
    for (const c of chapterStarts) if (c.start <= pos) label = c.title
    return label
  }
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + targetChars)
    if (end < text.length) {
      // Prefer to end at a paragraph break, then a sentence end, within the last 40% of the window.
      const window = text.slice(start + Math.floor(targetChars * 0.6), end)
      const para = window.lastIndexOf('\n\n')
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
      const cut = para >= 0 ? para + 2 : sentence >= 0 ? sentence + 2 : -1
      if (cut > 0) end = start + Math.floor(targetChars * 0.6) + cut
    }
    // Never cut a chapter title away from its chapter: start chunks at chapter boundaries.
    const nextChapter = chapterStarts.find((c) => c.start > start && c.start < end)
    if (nextChapter && nextChapter.start - start > targetChars * 0.25) end = nextChapter.start
    const content = text.slice(start, end)
    if (content.trim()) {
      chunks.push({
        index: chunks.length,
        chapterLabel: labelAt(start),
        content,
        charStart: start,
        charEnd: end,
        tokenEstimate: Math.ceil(content.length / 4),
      })
    }
    start = end
    while (start < text.length && /\s/.test(text[start])) start++
  }
  return chunks
}

export function summarize(format: ExtractionResult['format'], title: string | null, chapters: ExtractedChapter[], pageCount: number | null, warnings: string[], needsOcr = false): ExtractionResult {
  const wordCount = chapters.reduce((n, c) => n + c.wordCount, 0)
  const characterCount = chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + s.text.length, 0), 0)
  return { format, title, chapters, wordCount, characterCount, pageCount, warnings, needsOcr }
}
