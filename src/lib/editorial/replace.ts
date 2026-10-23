// Apply one accepted editorial revision to a scene: replace a passage inside a single
// paragraph, keeping the formatting of the text it replaces. Pure, so it is unit tested.

export interface TNode {
  type: string
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
  content?: TNode[]
}

const isTextblock = (n: TNode) => n.type === 'paragraph' || n.type === 'heading'
const inlineText = (n: TNode) => (n.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : c.type === 'hardBreak' ? '\n' : '')).join('')

/** Plain text of a document, matching the editor's saved text (blocks separated by a blank line). */
export function docPlainText(doc: TNode): string {
  const out: string[] = []
  const walk = (nodes: TNode[]) => {
    for (const n of nodes) {
      if (isTextblock(n)) out.push(inlineText(n))
      else if (n.type === 'horizontalRule') out.push('')
      else if (n.content) walk(n.content)
    }
  }
  walk(doc.content ?? [])
  return out.join('\n\n')
}

function replaceInBlock(block: TNode, original: string, proposed: string): TNode | null {
  const text = inlineText(block)
  const at = text.indexOf(original)
  if (at < 0) return null
  const end = at + original.length
  const out: TNode[] = []
  let pos = 0
  let inserted = false
  for (const c of block.content ?? []) {
    const len = c.type === 'text' ? (c.text ?? '').length : c.type === 'hardBreak' ? 1 : 0
    const s = pos
    const e = pos + len
    pos = e
    if (e <= at || s >= end) {
      if (s >= end && !inserted) {
        out.push(...(proposed ? [{ type: 'text', text: proposed }] : []))
        inserted = true
      }
      out.push(c)
      continue
    }
    // This node overlaps the replaced range.
    if (c.type !== 'text') continue
    const t = c.text ?? ''
    if (s < at) out.push({ ...c, text: t.slice(0, at - s) })
    if (!inserted) {
      if (proposed) out.push({ ...c, text: proposed })
      inserted = true
    }
    if (e > end) out.push({ ...c, text: t.slice(end - s) })
  }
  if (!inserted && proposed) out.push({ type: 'text', text: proposed })
  // Merge neighbours with identical marks and drop empty text nodes.
  const merged: TNode[] = []
  for (const n of out) {
    if (n.type === 'text' && !n.text) continue
    const prev = merged[merged.length - 1]
    if (prev && prev.type === 'text' && n.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      merged[merged.length - 1] = { ...prev, text: (prev.text ?? '') + (n.text ?? '') }
    } else merged.push(n)
  }
  return { ...block, content: merged.length ? merged : undefined }
}

/**
 * Replace the first paragraph occurrence of `original` with `proposed`. Returns the new
 * document, or null when the passage is no longer in the scene exactly as reviewed.
 * The original document is never modified.
 */
export function replaceInDoc<T extends TNode>(doc: T, original: string, proposed: string): T | null {
  if (!original || original.includes('\n')) return null
  let done = false
  const walk = (nodes: TNode[]): TNode[] =>
    nodes.map((n) => {
      if (done) return n
      if (isTextblock(n)) {
        const r = replaceInBlock(n, original, proposed)
        if (r) {
          done = true
          return r
        }
        return n
      }
      return n.content ? { ...n, content: walk(n.content) } : n
    })
  const content = walk(doc.content ?? [])
  return done ? { ...doc, content } : null
}
