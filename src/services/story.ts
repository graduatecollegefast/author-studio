import { supabase } from '@/lib/supabase/client'
import type { Route } from '@/lib/ai/catalog'
import { logActivity } from './books'
import { AppError, throwIfError } from './errors'

// ---------------------------------------------------------------------------
// Universes and series
// ---------------------------------------------------------------------------
export interface Universe {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export const SERIES_STATUSES = ['planning', 'active', 'complete', 'on_hold', 'archived'] as const

export interface Series {
  id: string
  universe_id: string | null
  name: string
  description: string | null
  genre: string | null
  planned_book_count: number | null
  status: (typeof SERIES_STATUSES)[number]
  notes: string | null
  created_at: string
  updated_at: string
}

export interface SeriesBook {
  series_id: string
  book_id: string
  reading_order: number | null
  chronological_order: number | null
  publication_order: number | null
  books: { id: string; title: string; writing_status: string; word_count: number; publication_date: string | null } | null
}

export async function listUniverses(): Promise<Array<Universe & { series: Array<{ id: string }>; book_universes: Array<{ book_id: string }> }>> {
  const { data, error } = await supabase
    .from('universes')
    .select('*, series(id), book_universes(book_id)')
    .order('name')
  throwIfError(error)
  return (data ?? []) as Array<Universe & { series: Array<{ id: string }>; book_universes: Array<{ book_id: string }> }>
}

export async function listSeries(): Promise<Array<Series & { series_books: Array<{ book_id: string }> }>> {
  const { data, error } = await supabase.from('series').select('*, series_books(book_id)').order('name')
  throwIfError(error)
  return (data ?? []) as Array<Series & { series_books: Array<{ book_id: string }> }>
}

export async function createUniverse(name: string): Promise<string> {
  const { data, error } = await supabase.from('universes').insert({ name: name.trim() }).select('id').single()
  throwIfError(error)
  await logActivity('universe.created', 'universe', data!.id, {})
  return data!.id
}

export async function createSeries(name: string, universeId: string | null): Promise<string> {
  const { data, error } = await supabase.from('series').insert({ name: name.trim(), universe_id: universeId }).select('id').single()
  throwIfError(error)
  await logActivity('series.created', 'series', data!.id, {})
  return data!.id
}

export async function getSeries(id: string): Promise<Series> {
  const { data, error } = await supabase.from('series').select('*').eq('id', id).single()
  throwIfError(error)
  return data as Series
}

export async function updateSeries(id: string, patch: Partial<Omit<Series, 'id' | 'created_at' | 'updated_at'>>) {
  const { error } = await supabase.from('series').update(patch).eq('id', id)
  throwIfError(error)
}

/** Deleting a series removes only the series and its order; books, characters and canon stay. */
export async function deleteSeries(id: string) {
  const { error } = await supabase.from('series').delete().eq('id', id)
  throwIfError(error)
  await logActivity('series.deleted', 'series', id, {})
}

export async function getUniverse(id: string): Promise<Universe> {
  const { data, error } = await supabase.from('universes').select('*').eq('id', id).single()
  throwIfError(error)
  return data as Universe
}

export async function updateUniverse(id: string, patch: { name?: string; description?: string | null }) {
  const { error } = await supabase.from('universes').update(patch).eq('id', id)
  throwIfError(error)
}

/** Deleting a universe keeps its series, books, characters and world details; they are simply unlinked. */
export async function deleteUniverse(id: string) {
  const { error } = await supabase.from('universes').delete().eq('id', id)
  throwIfError(error)
  await logActivity('universe.deleted', 'universe', id, {})
}

export async function seriesBooks(seriesId: string): Promise<SeriesBook[]> {
  const { data, error } = await supabase
    .from('series_books')
    .select('series_id, book_id, reading_order, chronological_order, publication_order, books!series_books_book_id_owner_id_fkey(id, title, writing_status, word_count, publication_date)')
    .eq('series_id', seriesId)
  throwIfError(error)
  return (data ?? []) as unknown as SeriesBook[]
}

export async function addBookToSeries(seriesId: string, bookId: string, position: number) {
  const { error } = await supabase
    .from('series_books')
    .insert({ series_id: seriesId, book_id: bookId, reading_order: position, chronological_order: position, publication_order: position })
  if (error?.code === '23505') throw new AppError('That book is already in this series.')
  throwIfError(error)
}

export async function removeBookFromSeries(seriesId: string, bookId: string) {
  const { error } = await supabase.from('series_books').delete().eq('series_id', seriesId).eq('book_id', bookId)
  throwIfError(error)
}

export type OrderKind = 'reading_order' | 'chronological_order' | 'publication_order'

export async function saveSeriesOrder(seriesId: string, rows: Array<{ book_id: string; reading_order: number | null; chronological_order: number | null; publication_order: number | null }>) {
  const { error } = await supabase.rpc('set_series_order', { p_series_id: seriesId, p_rows: rows })
  throwIfError(error)
}

export async function universeBooks(universeId: string): Promise<Array<{ id: string; title: string }>> {
  const { data, error } = await supabase
    .from('book_universes')
    .select('books!book_universes_book_id_owner_id_fkey(id, title)')
    .eq('universe_id', universeId)
  throwIfError(error)
  return ((data ?? []) as unknown as Array<{ books: { id: string; title: string } | null }>).flatMap((r) => (r.books ? [r.books] : []))
}

export async function addBookToUniverse(universeId: string, bookId: string) {
  const { error } = await supabase.from('book_universes').insert({ universe_id: universeId, book_id: bookId })
  if (error?.code === '23505') throw new AppError('That book is already in this universe.')
  throwIfError(error)
}

export async function removeBookFromUniverse(universeId: string, bookId: string) {
  const { error } = await supabase.from('book_universes').delete().eq('universe_id', universeId).eq('book_id', bookId)
  throwIfError(error)
}

/** Characters appearing in the given books, with how many of those books each appears in. */
export async function sharedCharacters(bookIds: string[]): Promise<Array<{ id: string; full_name: string; books: number }>> {
  if (!bookIds.length) return []
  const { data, error } = await supabase
    .from('character_appearances')
    .select('book_id, characters!character_appearances_character_id_owner_id_fkey(id, full_name)')
    .in('book_id', bookIds)
  throwIfError(error)
  const m = new Map<string, { id: string; full_name: string; books: Set<string> }>()
  for (const r of (data ?? []) as unknown as Array<{ book_id: string; characters: { id: string; full_name: string } | null }>) {
    if (!r.characters) continue
    const e = m.get(r.characters.id) ?? { ...r.characters, books: new Set<string>() }
    e.books.add(r.book_id)
    m.set(r.characters.id, e)
  }
  return [...m.values()].map((e) => ({ id: e.id, full_name: e.full_name, books: e.books.size })).sort((a, b) => b.books - a.books || a.full_name.localeCompare(b.full_name))
}

/** World elements linked to the given books, with how many of those books each appears in. */
export async function sharedWorld(bookIds: string[]): Promise<Array<{ id: string; name: string; category: string; rules: string | null; books: number }>> {
  if (!bookIds.length) return []
  const { data, error } = await supabase
    .from('world_element_links')
    .select('book_id, world_elements!world_element_links_world_element_id_owner_id_fkey(id, name, category, rules)')
    .in('book_id', bookIds)
  throwIfError(error)
  const m = new Map<string, { id: string; name: string; category: string; rules: string | null; books: Set<string> }>()
  for (const r of (data ?? []) as unknown as Array<{ book_id: string; world_elements: { id: string; name: string; category: string; rules: string | null } | null }>) {
    if (!r.world_elements) continue
    const e = m.get(r.world_elements.id) ?? { ...r.world_elements, books: new Set<string>() }
    e.books.add(r.book_id)
    m.set(r.world_elements.id, e)
  }
  return [...m.values()].map((e) => ({ id: e.id, name: e.name, category: e.category, rules: e.rules, books: e.books.size })).sort((a, b) => b.books - a.books || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Plot threads, story arcs, mysteries and future book ideas
// ---------------------------------------------------------------------------
export const THREAD_KINDS = [
  { id: 'thread', label: 'Plot threads' },
  { id: 'arc', label: 'Story arcs' },
  { id: 'mystery', label: 'Unresolved mysteries' },
  { id: 'future_idea', label: 'Future book ideas' },
] as const
export type ThreadKind = (typeof THREAD_KINDS)[number]['id']

export interface PlotThread {
  id: string
  series_id: string | null
  universe_id: string | null
  book_id: string | null
  kind: ThreadKind
  title: string
  description: string | null
  status: 'open' | 'resolved' | 'abandoned'
  opened_in_book_id: string | null
  resolved_in_book_id: string | null
  position: number
}

export async function listThreads(scope: { seriesId?: string; universeId?: string }): Promise<PlotThread[]> {
  let q = supabase.from('plot_threads').select('*').order('kind').order('position').order('created_at')
  if (scope.seriesId) q = q.eq('series_id', scope.seriesId)
  if (scope.universeId) q = q.eq('universe_id', scope.universeId)
  const { data, error } = await q
  throwIfError(error)
  return (data ?? []) as PlotThread[]
}

export async function saveThread(t: Partial<PlotThread> & { title: string; kind: ThreadKind }) {
  const row = {
    series_id: t.series_id ?? null,
    universe_id: t.universe_id ?? null,
    kind: t.kind,
    title: t.title.trim(),
    description: t.description?.trim() || null,
    status: t.status ?? 'open',
    opened_in_book_id: t.opened_in_book_id ?? null,
    resolved_in_book_id: t.resolved_in_book_id ?? null,
    position: t.position ?? 0,
  }
  const { error } = t.id ? await supabase.from('plot_threads').update(row).eq('id', t.id) : await supabase.from('plot_threads').insert(row)
  throwIfError(error)
}

export async function deleteThread(id: string) {
  const { error } = await supabase.from('plot_threads').delete().eq('id', id)
  throwIfError(error)
}

// ---------------------------------------------------------------------------
// Relationships and relationship groups
// ---------------------------------------------------------------------------
export const RELATIONSHIP_CATEGORIES = [
  ['romantic', 'Romantic'],
  ['sexual', 'Sexual'],
  ['married', 'Married'],
  ['former_partner', 'Former partner'],
  ['family', 'Family'],
  ['friendship', 'Friendship'],
  ['professional', 'Professional'],
  ['rivalry', 'Rivalry'],
  ['conflict', 'Conflict'],
  ['mentorship', 'Mentorship'],
  ['custom', 'Custom'],
] as const

export interface Relationship {
  id: string
  character_a_id: string
  character_b_id: string | null
  group_id: string | null
  category: string
  custom_label: string | null
  description: string | null
  current_status: string | null
  past_status: string | null
  important_changes: string | null
  start_period: string | null
  end_period: string | null
  start_book_id: string | null
  end_book_id: string | null
  notes: string | null
  relationship_books: Array<{ book_id: string }>
  relationship_events: Array<{ event_id: string }>
}

export interface RelationshipGroup {
  id: string
  name: string
  structure_type: string | null
  description: string | null
  relationship_group_members: Array<{ character_id: string; member_role: string | null }>
}

export async function listRelationships(): Promise<Relationship[]> {
  const { data, error } = await supabase.from('relationships').select('*, relationship_books(book_id), relationship_events(event_id)').limit(5000)
  throwIfError(error)
  return (data ?? []) as Relationship[]
}

export async function listGroups(): Promise<RelationshipGroup[]> {
  const { data, error } = await supabase.from('relationship_groups').select('id, name, structure_type, description, relationship_group_members(character_id, member_role)').order('name')
  throwIfError(error)
  return (data ?? []) as RelationshipGroup[]
}

export type RelationshipInput = Omit<Relationship, 'id' | 'relationship_books' | 'relationship_events'> & {
  id?: string
  bookIds: string[]
  eventIds: string[]
}

export async function saveRelationship(r: RelationshipInput): Promise<string> {
  const { id, bookIds, eventIds, ...fields } = r
  const row = { ...fields, custom_label: fields.custom_label?.trim() || null }
  const res = id
    ? await supabase.from('relationships').update(row).eq('id', id).select('id').single()
    : await supabase.from('relationships').insert(row).select('id').single()
  throwIfError(res.error)
  const relId = res.data!.id as string
  // Replace links: simple and safe because they carry no data of their own.
  await supabase.from('relationship_books').delete().eq('relationship_id', relId)
  await supabase.from('relationship_events').delete().eq('relationship_id', relId)
  if (bookIds.length) throwIfError((await supabase.from('relationship_books').insert(bookIds.map((b) => ({ relationship_id: relId, book_id: b })))).error)
  if (eventIds.length) throwIfError((await supabase.from('relationship_events').insert(eventIds.map((e) => ({ relationship_id: relId, event_id: e })))).error)
  return relId
}

export async function deleteRelationship(id: string) {
  const { error } = await supabase.from('relationships').delete().eq('id', id)
  throwIfError(error)
}

export async function saveGroup(g: { id?: string; name: string; structure_type: string | null; description: string | null; members: Array<{ character_id: string; member_role: string | null }> }) {
  const row = { name: g.name.trim(), structure_type: g.structure_type?.trim() || null, description: g.description?.trim() || null }
  const res = g.id ? await supabase.from('relationship_groups').update(row).eq('id', g.id).select('id').single() : await supabase.from('relationship_groups').insert(row).select('id').single()
  throwIfError(res.error)
  const gid = res.data!.id as string
  await supabase.from('relationship_group_members').delete().eq('group_id', gid)
  if (g.members.length) throwIfError((await supabase.from('relationship_group_members').insert(g.members.map((m) => ({ group_id: gid, ...m })))).error)
  return gid
}

export async function deleteGroup(id: string) {
  const { error } = await supabase.from('relationship_groups').delete().eq('id', id)
  throwIfError(error)
}

// ---------------------------------------------------------------------------
// Timeline events
// ---------------------------------------------------------------------------
export type { StoryEvent } from '@/lib/story/timeline'
export { eventDateLabel, sortEvents } from '@/lib/story/timeline'
import type { StoryEvent } from '@/lib/story/timeline'

export const EVENT_TYPES = ['plot', 'backstory', 'historical', 'relationship', 'birth', 'death', 'travel', 'reveal', 'other'] as const

export async function listEvents(): Promise<StoryEvent[]> {
  const { data, error } = await supabase
    .from('story_events')
    .select('*, story_event_characters(character_id), relationship_events(relationship_id)')
    .limit(10000)
  throwIfError(error)
  return (data ?? []) as StoryEvent[]
}

export type EventInput = Omit<StoryEvent, 'id' | 'story_event_characters' | 'relationship_events'> & { id?: string; characterIds: string[]; relationshipIds: string[] }

export async function saveEvent(e: EventInput): Promise<string> {
  const { id, characterIds, relationshipIds, ...fields } = e
  const res = id ? await supabase.from('story_events').update(fields).eq('id', id).select('id').single() : await supabase.from('story_events').insert(fields).select('id').single()
  throwIfError(res.error)
  const eid = res.data!.id as string
  await supabase.from('story_event_characters').delete().eq('event_id', eid)
  await supabase.from('relationship_events').delete().eq('event_id', eid)
  if (characterIds.length) throwIfError((await supabase.from('story_event_characters').insert(characterIds.map((c) => ({ event_id: eid, character_id: c })))).error)
  if (relationshipIds.length) throwIfError((await supabase.from('relationship_events').insert(relationshipIds.map((r) => ({ event_id: eid, relationship_id: r })))).error)
  return eid
}

export async function deleteEvent(id: string) {
  const { error } = await supabase.from('story_events').delete().eq('id', id)
  throwIfError(error)
}

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------
async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new AppError('You are signed out. Sign in again to continue.')
  let res: Response
  try {
    res = await fetch(`/.netlify/functions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AppError('Could not reach the server. Check your connection.')
  }
  if (res.status === 202) return {} as T
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new AppError(out.error ?? 'The server could not complete the request.')
  return out
}

export interface ContinuityEstimate {
  bookTitle: string
  relatedBooks: number
  canonFacts: number
  chaptersTotal: number
  chaptersToCheck: number
  chaptersWithoutCanon: number
  estimatedCostUsd: number
  route: Route | null
  spent: { today: number; month: number }
  allowed: boolean
  reason?: string
}
export const estimateContinuity = (bookId: string) => callFunction<ContinuityEstimate>('continuity-estimate', { bookId })
export const startContinuity = (bookId: string, action: 'start' | 'resume' | 'restart') => callFunction('continuity-check-background', { bookId, action })

export interface ContinuityTask {
  id: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  output: { chapters_total?: number; done?: string[]; findings?: number; unverified_dropped?: number; declined?: number; canon_checked?: boolean } | null
  error: string | null
  actual_cost_usd: number | null
  locked_at: string | null
  updated_at: string
  completed_at: string | null
}

export async function getContinuityTask(bookId: string): Promise<ContinuityTask | null> {
  const { data, error } = await supabase
    .from('ai_tasks')
    .select('id, status, output, error, actual_cost_usd, locked_at, updated_at, completed_at')
    .eq('idempotency_key', `continuity:${bookId}`)
    .maybeSingle()
  throwIfError(error)
  return data as ContinuityTask | null
}

export async function stopContinuity(taskId: string) {
  const { error } = await supabase.from('ai_tasks').update({ status: 'cancelled' }).eq('id', taskId).eq('status', 'running')
  throwIfError(error)
}

export const FINDING_STATUSES = [
  { id: 'open', label: 'Open' },
  { id: 'saved_for_later', label: 'Saved for later' },
  { id: 'accepted', label: 'Fix accepted' },
  { id: 'intentional', label: 'Intentional' },
  { id: 'dismissed', label: 'Dismissed' },
] as const
export type FindingStatus = (typeof FINDING_STATUSES)[number]['id']

export interface Finding {
  id: string
  book_id: string
  chapter_id: string | null
  scene_id: string | null
  category: string | null
  severity: 'critical' | 'warning' | 'suggestion'
  description: string
  original_evidence: string | null
  original_location: string | null
  conflicting_evidence: string | null
  conflicting_location: string | null
  suggested_resolution: string | null
  status: FindingStatus
  author_note: string | null
  canon_fact_ids: string[]
  created_at: string
  reviewed_at: string | null
}

export async function listFindings(bookId: string): Promise<Finding[]> {
  const { data, error } = await supabase
    .from('editorial_findings')
    .select('id, book_id, chapter_id, scene_id, category, severity, description, original_evidence, original_location, conflicting_evidence, conflicting_location, suggested_resolution, status, author_note, canon_fact_ids, created_at, reviewed_at')
    .eq('book_id', bookId)
    .eq('review_type', 'continuity')
    .order('created_at')
    .limit(5000)
  throwIfError(error)
  return (data ?? []) as Finding[]
}

/** Record the author's decision. Only the finding changes; canon and manuscript text are never touched. */
export async function setFindingStatus(id: string, status: FindingStatus, note?: string) {
  const { error } = await supabase
    .from('editorial_findings')
    .update({ status, reviewed_at: status === 'open' ? null : new Date().toISOString(), ...(note !== undefined ? { author_note: note || null } : {}) })
    .eq('id', id)
  throwIfError(error)
}
