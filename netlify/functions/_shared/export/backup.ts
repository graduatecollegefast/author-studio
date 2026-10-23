// Complete project backup (one ZIP: backup.json plus the stored manuscript and cover files)
// and restore. A restore always adds a copy with new ids, so it never overwrites or removes
// anything already in the account.
import type { SupabaseClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import { HttpError } from '../http'

export const BACKUP_FORMAT = 'author-studio-backup'
export const BACKUP_VERSION = 1

/** Restore order: every table comes after the tables it points to. */
export const BACKUP_TABLES = [
  'universes',
  'series',
  'books',
  'series_books',
  'book_universes',
  'book_crossovers',
  'manuscript_files',
  'writing_profiles',
  'chapters',
  'characters',
  'scenes',
  'scene_versions',
  'character_states',
  'character_appearances',
  'relationship_groups',
  'relationship_group_members',
  'relationships',
  'relationship_books',
  'world_elements',
  'story_events',
  'story_event_characters',
  'relationship_events',
  'world_element_links',
  'plot_threads',
  'document_chunks',
  'canon_facts',
  'fact_sources',
  'ideas',
  'idea_characters',
  'clarification_questions',
  'editorial_findings',
  'revision_proposals',
  'story_plans',
  'ai_conversations',
  'ai_messages',
] as const
type Table = (typeof BACKUP_TABLES)[number]

/** Settings that belong to the account rather than a project. Restored only where nothing exists yet. */
const ACCOUNT_TABLES = ['ai_settings', 'writing_daily_stats'] as const

/** Columns filled later, after the rows they point to exist. */
const DEFERRED: Partial<Record<Table, string[]>> = {
  books: ['original_manuscript_file_id', 'current_manuscript_file_id', 'style_profile_id'],
  canon_facts: ['superseded_by'],
}
/** Columns never restored: computed by the database, or pointing at AI job records that are not backed up. */
const DROP = new Set(['owner_id', 'search', 'ai_task_id'])

/** Key columns of tables without an id column. */
const KEYS: Record<string, string[]> = {
  series_books: ['series_id', 'book_id'],
  book_universes: ['book_id', 'universe_id'],
  book_crossovers: ['book_id', 'universe_id'],
  relationship_books: ['relationship_id', 'book_id'],
  relationship_events: ['relationship_id', 'event_id'],
  story_event_characters: ['event_id', 'character_id'],
  idea_characters: ['idea_id', 'character_id'],
  relationship_group_members: ['group_id', 'character_id'],
  writing_daily_stats: ['day'],
  ai_settings: ['owner_id'],
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const MAX_ROWS = 400_000

export interface BackupFile {
  bucket: 'manuscripts' | 'covers'
  path: string
  mime?: string | null
}

export interface BackupJson {
  format: typeof BACKUP_FORMAT
  version: number
  app: string
  created_at: string
  owner_id: string
  profile: Record<string, unknown> | null
  tables: Record<string, Array<Record<string, unknown>>>
  files: BackupFile[]
}

async function fetchAll(db: SupabaseClient, table: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = []
  for (let from = 0; ; from += 1000) {
    let q = db
      .from(table)
      .select('*')
      .range(from, from + 999)
    // A stable order so paging never skips or repeats rows.
    for (const col of KEYS[table] ?? ['id']) q = q.order(col)
    const { data, error } = await q
    if (error) throw new Error(`backup ${table}: ${error.message}`)
    rows.push(...((data ?? []) as Array<Record<string, unknown>>))
    if (!data || data.length < 1000) break
    if (rows.length > MAX_ROWS) throw new HttpError(413, 'This project is too large to back up in one file.')
  }
  return rows.map((r) => {
    const { search: _s, ...rest } = r
    void _s
    return rest
  })
}

/** Build the backup ZIP for everything the signed-in author owns. */
export async function buildBackup(
  db: SupabaseClient,
  ownerId: string,
  onProgress?: (msg: string) => Promise<void>,
): Promise<{ zip: Uint8Array; counts: Record<string, number> }> {
  const tables: BackupJson['tables'] = {}
  const counts: Record<string, number> = {}
  for (const t of [...BACKUP_TABLES, ...ACCOUNT_TABLES]) {
    tables[t] = await fetchAll(db, t)
    counts[t] = tables[t].length
  }
  const { data: profile } = await db.from('profiles').select('display_name, pen_names, theme, preferences').eq('id', ownerId).maybeSingle()
  const files: BackupFile[] = [
    ...tables.manuscript_files
      .filter((f) => f.storage_path)
      .map((f) => ({ bucket: 'manuscripts' as const, path: String(f.storage_path), mime: (f.mime_type as string) ?? null })),
    ...tables.books.filter((b) => b.cover_path).map((b) => ({ bucket: 'covers' as const, path: String(b.cover_path) })),
  ]
  const zip = new JSZip()
  const stored: BackupFile[] = []
  let i = 0
  for (const f of files) {
    i++
    if (onProgress && i % 10 === 0) await onProgress(`Packing files ${i} of ${files.length}`)
    const { data, error } = await db.storage.from(f.bucket).download(f.path)
    if (error || !data) continue // a missing file is skipped; its record is still backed up
    zip.file(`files/${f.bucket}/${f.path}`, new Uint8Array(await data.arrayBuffer()))
    stored.push(f)
  }
  counts.files = stored.length
  const json: BackupJson = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: 'Author Studio AI',
    created_at: new Date().toISOString(),
    owner_id: ownerId,
    profile: (profile as Record<string, unknown>) ?? null,
    tables,
    files: stored,
  }
  zip.file('backup.json', JSON.stringify(json))
  zip.file(
    'README.txt',
    'Author Studio AI project backup.\n\nbackup.json holds every book, chapter, scene, version, character, world element, timeline event, relationship, idea, note and review.\nThe files folder holds uploaded manuscripts and covers.\n\nRestore it from Exports > Restore a backup. Restoring adds a copy and never replaces what is already in your account.\n',
  )
  return { zip: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }), counts }
}

/** Replace every id from the backup with its new id, and the old account id with the new one. */
export function makeRemap(map: Map<string, string>, oldOwner: string, newOwner: string) {
  const swap = (s: string) =>
    s.replace(UUID, (m) => {
      const k = m.toLowerCase()
      return map.get(k) ?? (k === oldOwner.toLowerCase() ? newOwner : m)
    })
  const remap = (v: unknown): unknown => {
    if (typeof v === 'string') return swap(v)
    if (Array.isArray(v)) return v.map(remap)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, remap(x)]))
    return v
  }
  return remap
}

export function parseBackup(raw: unknown): BackupJson {
  const b = raw as Partial<BackupJson> | null
  if (!b || b.format !== BACKUP_FORMAT || typeof b.tables !== 'object' || !b.tables)
    throw new HttpError(400, 'This file is not an Author Studio backup.')
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION)
    throw new HttpError(400, 'This backup was made by a newer version of Author Studio.')
  if (typeof b.owner_id !== 'string') throw new HttpError(400, 'This backup is missing its account details.')
  let total = 0
  for (const [t, rows] of Object.entries(b.tables)) {
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r)))
      throw new HttpError(400, `The backup is damaged (${t}).`)
    total += rows.length
  }
  if (total > MAX_ROWS) throw new HttpError(413, 'This backup is too large to restore.')
  return b as BackupJson
}

export interface RestoreResult {
  counts: Record<string, number>
  files: number
  files_missing: number
  books: Array<{ id: string; title: string }>
}

/**
 * Restore a backup into the signed-in account as a copy. On failure everything this restore
 * added is removed again, so a failed restore leaves the account as it was.
 */
export async function restoreBackup(
  db: SupabaseClient,
  ownerId: string,
  zipBytes: Uint8Array,
  onProgress?: (msg: string) => Promise<void>,
): Promise<RestoreResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(zipBytes)
  } catch {
    throw new HttpError(400, 'This file is not a ZIP backup.')
  }
  const entry = zip.file('backup.json')
  if (!entry) throw new HttpError(400, 'This ZIP has no backup.json, so it is not an Author Studio backup.')
  let parsed: unknown
  try {
    parsed = JSON.parse(await entry.async('string'))
  } catch {
    throw new HttpError(400, 'The backup is damaged and could not be read.')
  }
  const backup = parseBackup(parsed)

  // New ids for every row that has one.
  const map = new Map<string, string>()
  for (const t of BACKUP_TABLES)
    for (const r of backup.tables[t] ?? []) if (typeof r.id === 'string') map.set(r.id.toLowerCase(), crypto.randomUUID())
  const remap = makeRemap(map, backup.owner_id, ownerId)

  // Restored books get "(restored)" when a book with that title already exists.
  const { data: existing } = await db.from('books').select('title').limit(5000)
  const titles = new Set((existing ?? []).map((b) => String(b.title).toLowerCase()))

  const inserted: Array<{ table: Table; ids: string[] }> = []
  const counts: Record<string, number> = {}
  const deferred: Array<{ table: Table; id: string; patch: Record<string, unknown> }> = []
  try {
    for (const t of BACKUP_TABLES) {
      const rows = (backup.tables[t] ?? []).map((r) => {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(r)) if (!DROP.has(k)) out[k] = remap(v)
        const later: Record<string, unknown> = {}
        for (const k of DEFERRED[t] ?? []) {
          if (out[k] != null) later[k] = out[k]
          if (k in out) out[k] = null
        }
        if (Object.keys(later).length && typeof out.id === 'string') deferred.push({ table: t, id: out.id, patch: later })
        if (t === 'books' && typeof out.title === 'string' && titles.has(out.title.toLowerCase())) out.title = `${out.title} (restored)`
        return out
      })
      if (!rows.length) continue
      if (onProgress) await onProgress(`Restoring ${t.replace(/_/g, ' ')}`)
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500)
        const { error } = await db.from(t).insert(chunk)
        if (error) throw new Error(`restore ${t}: ${error.message}`)
        inserted.push({ table: t, ids: chunk.map((r) => r.id).filter((x): x is string => typeof x === 'string') })
      }
      counts[t] = rows.length
    }
    for (const d of deferred) {
      const { error } = await db.from(d.table).update(d.patch).eq('id', d.id)
      if (error) throw new Error(`restore links ${d.table}: ${error.message}`)
    }
  } catch (err) {
    await undo(db, inserted)
    throw err
  }

  // Account settings only where none exist yet; never replaces current settings.
  for (const t of ACCOUNT_TABLES) {
    const rows = (backup.tables[t] ?? []).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'owner_id' && k !== 'updated_at')))
    if (!rows.length) continue
    await db.from(t).upsert(rows, { onConflict: t === 'ai_settings' ? 'owner_id' : 'owner_id,day', ignoreDuplicates: true })
  }
  if (backup.profile) {
    const { data: me } = await db.from('profiles').select('display_name, pen_names').eq('id', ownerId).maybeSingle()
    const pens = [
      ...new Set([
        ...((me?.pen_names as string[]) ?? []),
        ...(Array.isArray(backup.profile.pen_names) ? (backup.profile.pen_names as string[]) : []),
      ]),
    ]
    await db
      .from('profiles')
      .update({ display_name: me?.display_name || (backup.profile.display_name as string | null) || null, pen_names: pens })
      .eq('id', ownerId)
  }

  // Files: same layout under the new account and ids.
  let files = 0
  let missing = 0
  for (const f of Array.isArray(backup.files) ? backup.files : []) {
    if (f.bucket !== 'manuscripts' && f.bucket !== 'covers') continue
    const src = zip.file(`files/${f.bucket}/${f.path}`)
    if (!src) {
      missing++
      continue
    }
    const target = remap(f.path) as string
    if (!target.startsWith(`${ownerId}/`)) {
      missing++
      continue
    }
    const body = await src.async('uint8array')
    const ext = target.split('.').pop()?.toLowerCase()
    const type =
      f.mime ||
      (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream')
    const { error } = await db.storage.from(f.bucket).upload(target, body, { contentType: type, upsert: true })
    if (error) missing++
    else files++
    if (onProgress && (files + missing) % 10 === 0) await onProgress(`Restoring files ${files + missing} of ${backup.files.length}`)
  }

  const bookIds = new Set(inserted.filter((x) => x.table === 'books').flatMap((x) => x.ids))
  const { data: books } = bookIds.size
    ? await db
        .from('books')
        .select('id, title')
        .in('id', [...bookIds])
    : { data: [] }
  return { counts, files, files_missing: missing, books: (books ?? []) as Array<{ id: string; title: string }> }
}

/** Remove what a failed restore added, newest first. Scenes go with their chapters. */
async function undo(db: SupabaseClient, inserted: Array<{ table: Table; ids: string[] }>) {
  for (const x of [...inserted].reverse()) {
    if (x.table === 'scenes' || x.table === 'scene_versions' || !x.ids.length) continue
    for (let i = 0; i < x.ids.length; i += 200)
      await db
        .from(x.table)
        .delete()
        .in('id', x.ids.slice(i, i + 200))
  }
}
