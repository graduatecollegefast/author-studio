import { supabase } from '@/lib/supabase/client'
import { logActivity } from './books'
import { throwIfError } from './errors'
import type { FactSource } from './ai'

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------
export interface Character {
  id: string
  universe_id: string | null
  full_name: string
  preferred_name: string | null
  nicknames: string[]
  aliases: string[]
  pronouns: string | null
  gender_identity: string | null
  sexual_orientation: string | null
  romantic_orientation: string | null
  date_of_birth: string | null
  age: string | null
  occupation: string | null
  education: string | null
  role: string | null
  appearance: Record<string, string>
  personality: Record<string, string>
  history: Record<string, string>
  custom_fields: Record<string, string>
  notes: string | null
  first_appearance_book_id: string | null
  created_at: string
  updated_at: string
}

export const APPEARANCE_FIELDS = [
  ['height', 'Height'],
  ['build', 'Build'],
  ['skin_tone', 'Skin tone'],
  ['hair', 'Hair'],
  ['eyes', 'Eyes'],
  ['clothing', 'Clothing style'],
  ['distinguishing_features', 'Distinguishing features'],
  ['tattoos', 'Tattoos'],
  ['scars', 'Scars'],
  ['other', 'Other physical details'],
] as const
export const PERSONALITY_FIELDS = [
  ['trait', 'Traits'],
  ['strength', 'Strengths'],
  ['weakness', 'Weaknesses'],
  ['habit', 'Habits'],
  ['value', 'Values'],
  ['fear', 'Fears'],
  ['desire', 'Desires'],
  ['motivation', 'Motivations'],
  ['trigger', 'Emotional triggers'],
  ['communication', 'Communication style'],
  ['speech_pattern', 'Speech patterns'],
] as const
export const HISTORY_FIELDS = [
  ['background', 'Background'],
  ['family', 'Family'],
  ['childhood', 'Childhood'],
  ['important_event', 'Important events'],
  ['trauma', 'Trauma'],
  ['secret', 'Secrets'],
  ['past_relationship', 'Past relationships'],
  ['life_change', 'Major life changes'],
] as const

export interface CharacterListItem {
  id: string
  full_name: string
  preferred_name: string | null
  role: string | null
  occupation: string | null
  aliases: string[]
  character_appearances: Array<{ book_id: string }>
}

export async function listCharacters(search = ''): Promise<CharacterListItem[]> {
  let q = supabase
    .from('characters')
    .select('id, full_name, preferred_name, role, occupation, aliases, character_appearances(book_id)')
    .order('full_name')
    .limit(1000)
  const s = search.trim().replace(/[%_,()]/g, ' ')
  if (s) q = q.or(`full_name.ilike.%${s}%,preferred_name.ilike.%${s}%,occupation.ilike.%${s}%,role.ilike.%${s}%`)
  const { data, error } = await q
  throwIfError(error)
  return (data ?? []) as CharacterListItem[]
}

export async function getCharacter(id: string): Promise<Character> {
  const { data, error } = await supabase.from('characters').select('*').eq('id', id).single()
  throwIfError(error)
  return data as Character
}

export async function createCharacter(fullName: string): Promise<string> {
  const { data, error } = await supabase.from('characters').insert({ full_name: fullName.trim() }).select('id').single()
  throwIfError(error)
  await logActivity('character.created', 'character', data!.id, {})
  return data!.id
}

export type CharacterPatch = Partial<Omit<Character, 'id' | 'created_at' | 'updated_at'>>

export async function updateCharacter(id: string, patch: CharacterPatch) {
  const { error } = await supabase.from('characters').update(patch).eq('id', id)
  throwIfError(error)
}

export async function deleteCharacter(id: string) {
  const { error } = await supabase.from('characters').delete().eq('id', id)
  throwIfError(error)
  await logActivity('character.deleted', 'character', id, {})
}

/**
 * Merge duplicate characters into `keepId`. The kept profile wins; missing details are filled
 * from the others, their names become aliases, and every link moves to the kept character.
 * A full copy of each merged record is saved in the activity log first.
 */
export async function mergeCharacters(keepId: string, mergeIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('merge_characters', { p_keep: keepId, p_merge: mergeIds })
  throwIfError(error)
}

/** Characters that look like the same person: same name, or one's name is the other's alias. */
export function likelyDuplicates(
  target: { id: string; full_name: string; preferred_name?: string | null; aliases?: string[] },
  all: CharacterListItem[],
): string[] {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const mine = new Set([target.full_name, target.preferred_name, ...(target.aliases ?? [])].map(norm).filter(Boolean))
  return all
    .filter((c) => c.id !== target.id && [c.full_name, c.preferred_name, ...(c.aliases ?? [])].map(norm).some((n) => n && mine.has(n)))
    .map((c) => c.id)
}

export interface CanonFact {
  id: string
  attribute: string
  value: string
  statement_type: string
  confidence: number | null
  book_id: string | null
  approved_at: string | null
  fact_sources: FactSource[]
}

export async function approvedFactsFor(entityType: string, entityId: string): Promise<CanonFact[]> {
  const { data, error } = await supabase
    .from('canon_facts')
    .select(
      'id, attribute, value, statement_type, confidence, book_id, approved_at, fact_sources(id, location_label, excerpt, char_start, char_end, manuscript_file_id, book_id)',
    )
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('status', 'approved')
    .order('attribute')
    .order('approved_at')
  throwIfError(error)
  return (data ?? []) as unknown as CanonFact[]
}

export interface CharacterState {
  id: string
  attribute: string
  value: string
  book_id: string | null
  period_label: string | null
  notes: string | null
  created_at: string
}

export async function characterStates(id: string): Promise<CharacterState[]> {
  const { data, error } = await supabase
    .from('character_states')
    .select('id, attribute, value, book_id, period_label, notes, created_at')
    .eq('character_id', id)
    .order('created_at')
  throwIfError(error)
  return (data ?? []) as CharacterState[]
}

export interface RelationshipRow {
  id: string
  category: string
  custom_label: string | null
  description: string | null
  current_status: string | null
  start_book_id: string | null
  character_a_id: string
  character_b_id: string | null
  a: { id: string; full_name: string } | null
  b: { id: string; full_name: string } | null
}

export async function relationshipsFor(characterId: string): Promise<RelationshipRow[]> {
  const { data, error } = await supabase
    .from('relationships')
    .select(
      'id, category, custom_label, description, current_status, start_book_id, character_a_id, character_b_id, a:characters!relationships_character_a_id_owner_id_fkey(id, full_name), b:characters!relationships_character_b_id_owner_id_fkey(id, full_name)',
    )
    .or(`character_a_id.eq.${characterId},character_b_id.eq.${characterId}`)
  throwIfError(error)
  return (data ?? []) as unknown as RelationshipRow[]
}

export async function characterBooks(characterId: string): Promise<Array<{ id: string; title: string }>> {
  const { data, error } = await supabase
    .from('character_appearances')
    .select('book_id, books!character_appearances_book_id_owner_id_fkey(id, title)')
    .eq('character_id', characterId)
  throwIfError(error)
  const seen = new Map<string, { id: string; title: string }>()
  for (const r of (data ?? []) as unknown as Array<{ books: { id: string; title: string } | null }>) if (r.books) seen.set(r.books.id, r.books)
  return [...seen.values()]
}

// ---------------------------------------------------------------------------
// World elements
// ---------------------------------------------------------------------------
export const WORLD_CATEGORY_LABELS: Record<string, string> = {
  place: 'Places',
  home: 'Homes',
  city: 'Cities',
  business: 'Businesses',
  school: 'Schools',
  organization: 'Organizations',
  social_group: 'Social groups',
  historical_event: 'Historical events',
  culture: 'Cultures',
  tradition: 'Traditions',
  law: 'Laws',
  custom: 'Customs',
  community: 'Communities',
  relationship_structure: 'Relationship structures',
  object: 'Important objects',
  technology: 'Fictional technologies',
  supernatural: 'Supernatural elements',
  other: 'Other',
}

export interface WorldElement {
  id: string
  universe_id: string | null
  name: string
  category: string
  description: string | null
  history: string | null
  rules: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export async function listWorldElements(
  search = '',
  category = '',
): Promise<Array<WorldElement & { world_element_links: Array<{ book_id: string | null }> }>> {
  let q = supabase.from('world_elements').select('*, world_element_links(book_id)').order('name').limit(2000)
  if (category) q = q.eq('category', category)
  const s = search.trim().replace(/[%_,()]/g, ' ')
  if (s) q = q.or(`name.ilike.%${s}%,description.ilike.%${s}%`)
  const { data, error } = await q
  throwIfError(error)
  return (data ?? []) as Array<WorldElement & { world_element_links: Array<{ book_id: string | null }> }>
}

export async function getWorldElement(id: string): Promise<WorldElement> {
  const { data, error } = await supabase.from('world_elements').select('*').eq('id', id).single()
  throwIfError(error)
  return data as WorldElement
}

export async function createWorldElement(name: string, category: string): Promise<string> {
  const { data, error } = await supabase.from('world_elements').insert({ name: name.trim(), category }).select('id').single()
  if (error?.code === '23505') {
    const err = new Error('An element with this name already exists in that category.')
    throw err
  }
  throwIfError(error)
  await logActivity('world_element.created', 'world_element', data!.id, {})
  return data!.id
}

export async function updateWorldElement(id: string, patch: Partial<Omit<WorldElement, 'id' | 'created_at' | 'updated_at'>>) {
  const { error } = await supabase.from('world_elements').update(patch).eq('id', id)
  if (error?.code === '23505') throw new Error('An element with this name already exists in that category.')
  throwIfError(error)
}

export async function deleteWorldElement(id: string) {
  const { error } = await supabase.from('world_elements').delete().eq('id', id)
  throwIfError(error)
  await logActivity('world_element.deleted', 'world_element', id, {})
}

export async function worldElementBooks(id: string): Promise<Array<{ id: string; title: string }>> {
  const { data, error } = await supabase
    .from('world_element_links')
    .select('books!world_element_links_book_id_owner_id_fkey(id, title)')
    .eq('world_element_id', id)
    .not('book_id', 'is', null)
  throwIfError(error)
  return ((data ?? []) as unknown as Array<{ books: { id: string; title: string } | null }>).flatMap((r) => (r.books ? [r.books] : []))
}

export async function bookTitles(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('books').select('id, title')
  throwIfError(error)
  return new Map((data ?? []).map((b) => [b.id as string, b.title as string]))
}
