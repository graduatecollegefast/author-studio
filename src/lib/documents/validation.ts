// Shared by the browser (pre-upload checks) and Netlify Functions (server checks).
// Keep this file free of DOM and Node-only APIs.

export const MANUSCRIPT_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  txt: 'text/plain',
  md: 'text/markdown',
} as const

export type ManuscriptExt = keyof typeof MANUSCRIPT_TYPES

export const MAX_MANUSCRIPT_BYTES = 100 * 1024 * 1024 // 100 MB, matches the storage bucket limit

export const COVER_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const
export type CoverExt = keyof typeof COVER_TYPES
export const MAX_COVER_BYTES = 10 * 1024 * 1024

export function getExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function isManuscriptExt(ext: string): ext is ManuscriptExt {
  return Object.prototype.hasOwnProperty.call(MANUSCRIPT_TYPES, ext)
}

export function isCoverExt(ext: string): ext is CoverExt {
  return Object.prototype.hasOwnProperty.call(COVER_TYPES, ext)
}

/**
 * Produce a storage-safe file name: no directories, no traversal, no control
 * characters, limited charset and length. The extension is preserved.
 */
export function sanitizeFileName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? '').normalize('NFKD')
  const ext = getExtension(base)
  const stem = ext ? base.slice(0, -(ext.length + 1)) : base
  const cleanStem =
    stem
      .replace(/[^\w\s.-]/g, '')
      .replace(/\.+/g, '.')
      .replace(/\s+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 80) || 'file'
  return ext ? `${cleanStem}.${ext.replace(/[^a-z0-9]/g, '')}` : cleanStem
}

export type ValidationResult = { ok: true; ext: string; mime: string } | { ok: false; error: string }

export function validateManuscriptFile(name: string, size: number): ValidationResult {
  const ext = getExtension(name)
  if (!isManuscriptExt(ext)) {
    return { ok: false, error: 'Unsupported file type. Use DOCX, PDF, EPUB, TXT, or Markdown (.md).' }
  }
  if (size <= 0) return { ok: false, error: 'The file is empty.' }
  if (size > MAX_MANUSCRIPT_BYTES) return { ok: false, error: 'The file is larger than 100 MB.' }
  return { ok: true, ext, mime: MANUSCRIPT_TYPES[ext] }
}

export function validateCoverFile(name: string, size: number): ValidationResult {
  const ext = getExtension(name)
  if (!isCoverExt(ext)) return { ok: false, error: 'Covers must be JPG, PNG, or WebP images.' }
  if (size <= 0) return { ok: false, error: 'The file is empty.' }
  if (size > MAX_COVER_BYTES) return { ok: false, error: 'Cover images must be 10 MB or smaller.' }
  return { ok: true, ext, mime: COVER_TYPES[ext] }
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b)
const ascii = (bytes: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...bytes.subarray(start, start + len))

/**
 * Check a file's leading bytes against its declared type. Pass at least the
 * first 512 bytes. Returns an error message, or null when the content matches.
 */
export function checkMagicBytes(ext: ManuscriptExt, head: Uint8Array): string | null {
  switch (ext) {
    case 'pdf':
      return ascii(head, 0, 5) === '%PDF-' ? null : 'This file does not look like a PDF.'
    case 'docx':
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]) ? null : 'This file does not look like a Word (.docx) document.'
    case 'epub': {
      if (!startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return 'This file does not look like an EPUB.'
      // EPUB requires an uncompressed "mimetype" entry first containing application/epub+zip.
      const text = ascii(head, 0, Math.min(head.length, 120))
      return text.includes('mimetypeapplication/epub+zip') ? null : 'This file is a ZIP archive but not a valid EPUB.'
    }
    case 'txt':
    case 'md':
      return looksLikeText(head) ? null : 'This file contains binary data and is not plain text.'
  }
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  let suspicious = 0
  for (const b of bytes) {
    if (b === 0) return false
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) suspicious++
  }
  if (suspicious / bytes.length > 0.05) return false
  // The sample may end in the middle of a multi-byte character, so allow up to 3 trailing bytes to be cut.
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let cut = 0; cut <= 3 && cut < bytes.length; cut++) {
    try {
      decoder.decode(bytes.subarray(0, bytes.length - cut))
      return true
    } catch {
      // try a shorter window
    }
  }
  // Not UTF-8. Accept legacy single-byte text only when it has no control characters.
  return suspicious === 0
}

export function buildStoragePath(userId: string, bookId: string, fileId: string, fileName: string): string {
  return `${userId}/${bookId}/${fileId}-${sanitizeFileName(fileName)}`
}
