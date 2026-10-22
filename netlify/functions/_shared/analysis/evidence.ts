// Locate a model-quoted excerpt in the source text. Discoveries whose evidence cannot be
// found word for word (ignoring case, quote style, dashes and spacing) are discarded, so
// the review queue never shows invented quotations.

function normChar(c: string): string {
  if (/[‘’‚‛′`]/.test(c)) return "'"
  if (/[“”„‟″]/.test(c)) return '"'
  if (/[‐-―−]/.test(c)) return '-'
  if (c === '…') return '...'
  return c.toLowerCase()
}

/** Normalized text plus, for each normalized character, its index in the original. */
function normalize(text: string): { s: string; map: number[] } {
  let s = ''
  const map: number[] = []
  let space = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (/\s/.test(c)) {
      if (!space && s.length) {
        s += ' '
        map.push(i)
      }
      space = true
      continue
    }
    space = false
    for (const n of normChar(c)) {
      s += n
      map.push(i)
    }
  }
  if (s.endsWith(' ')) {
    s = s.slice(0, -1)
    map.pop()
  }
  return { s, map }
}

export function locateExcerpt(content: string, excerpt: string): { start: number; end: number } | null {
  const ex = normalize(excerpt.replace(/^["'“‘\s]+|["'”’\s]+$/g, '')).s
  if (ex.split(' ').filter(Boolean).length < 3) return null
  const src = normalize(content)
  const find = (needle: string) => {
    const at = src.s.indexOf(needle)
    if (at < 0) return null
    return { start: src.map[at], end: src.map[at + needle.length - 1] + 1 }
  }
  const whole = find(ex)
  if (whole) return whole
  // An elided quote ("... she said ... "): accept its longest piece if it is substantial.
  const pieces = ex.split('...').map((p) => p.trim()).filter((p) => p.length >= 25)
  pieces.sort((a, b) => b.length - a.length)
  return pieces.length ? find(pieces[0]) : null
}
