// One document model for every export, so all five formats keep the same chapter order,
// titles, paragraphs, scene breaks, and bold and italic text.

export interface Inline {
  text: string
  bold?: boolean
  italic?: boolean
}

export type ExportBlock =
  { kind: 'heading'; level: 2 | 3; text: string } | { kind: 'paragraph'; runs: Inline[]; style?: 'body' | 'meta' | 'quote' } | { kind: 'break' }

export interface ExportSection {
  title: string
  blocks: ExportBlock[]
}

export interface ExportDoc {
  title: string
  subtitle?: string | null
  author?: string | null
  /** Shown under the title on the title page. */
  description?: string | null
  sections: ExportSection[]
}

// Remove characters that are invalid in XML 1.0 and in PDF text.
// eslint-disable-next-line no-control-regex
export const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')

export const p = (text: string, style: 'body' | 'meta' | 'quote' = 'body'): ExportBlock => ({ kind: 'paragraph', runs: [{ text }], style })

/** "Label: value" with the label in bold, for bibles and overviews. */
export const field = (label: string, value: string | null | undefined): ExportBlock[] =>
  value && String(value).trim()
    ? [{ kind: 'paragraph', style: 'meta', runs: [{ text: `${label}: `, bold: true }, { text: String(value).trim() }] }]
    : []

interface TipNode {
  type: string
  text?: string
  marks?: Array<{ type: string }>
  content?: TipNode[]
  attrs?: Record<string, unknown>
}

/** Convert saved editor content to export blocks. Only text, bold, italic and structure survive. */
export function tiptapToBlocks(doc: unknown): ExportBlock[] {
  const out: ExportBlock[] = []
  const runs = (n: TipNode): Inline[] =>
    (n.content ?? []).flatMap((c) => {
      if (c.type === 'text' && c.text) {
        const marks = new Set((c.marks ?? []).map((m) => m.type))
        return [{ text: clean(c.text), bold: marks.has('bold') || undefined, italic: marks.has('italic') || undefined }]
      }
      if (c.type === 'hardBreak') return [{ text: '\n' }]
      return c.content ? runs(c) : []
    })
  const walk = (nodes: TipNode[], quote = false) => {
    for (const n of nodes) {
      if (n.type === 'paragraph') {
        const r = runs(n)
        if (r.some((x) => x.text.trim())) out.push({ kind: 'paragraph', runs: r, style: quote ? 'quote' : 'body' })
      } else if (n.type === 'heading') {
        const text = runs(n)
          .map((r) => r.text)
          .join('')
          .trim()
        if (text) out.push({ kind: 'heading', level: Number(n.attrs?.level ?? 2) >= 3 ? 3 : 2, text })
      } else if (n.type === 'horizontalRule') {
        out.push({ kind: 'break' })
      } else if (n.type === 'blockquote') {
        walk(n.content ?? [], true)
      } else if (n.type === 'bulletList' || n.type === 'orderedList') {
        ;(n.content ?? []).forEach((li, i) => {
          const r = (li.content ?? []).flatMap((c) => runs(c))
          if (r.length) out.push({ kind: 'paragraph', style: 'body', runs: [{ text: n.type === 'orderedList' ? `${i + 1}. ` : '• ' }, ...r] })
        })
      } else if (n.content) {
        walk(n.content, quote)
      }
    }
  }
  const root = doc as TipNode | null
  walk(root?.content ?? [])
  return out
}

export function slug(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export'
  )
}
