import { supabase } from '@/lib/supabase/client'
import type { Chapter, SaveResult, Scene, SceneMeta, SceneVersion, TiptapDoc } from '@/types/db'
import { AppError, throwIfError } from './errors'
import { ConflictError } from '@/lib/autosave'

const SCENE_META_COLUMNS =
  'id, owner_id, book_id, chapter_id, title, position, summary, word_count, revision, last_edited_at, created_at, updated_at'

export async function listChapters(bookId: string): Promise<Chapter[]> {
  const { data, error } = await supabase.from('chapters').select('*').eq('book_id', bookId).order('position')
  throwIfError(error)
  return (data ?? []) as Chapter[]
}

export async function listSceneMeta(bookId: string): Promise<SceneMeta[]> {
  const { data, error } = await supabase
    .from('scenes')
    .select(SCENE_META_COLUMNS)
    .eq('book_id', bookId)
    .order('position')
  throwIfError(error)
  return (data ?? []) as SceneMeta[]
}

export async function getScene(id: string): Promise<Scene> {
  const { data, error } = await supabase.from('scenes').select('*').eq('id', id).single()
  throwIfError(error)
  return data as Scene
}

export async function createChapter(bookId: string, title?: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_chapter', { p_book_id: bookId, p_title: title ?? null })
  throwIfError(error)
  return data as string
}

export async function renameChapter(id: string, title: string) {
  const { error } = await supabase.from('chapters').update({ title }).eq('id', id)
  throwIfError(error)
}

export async function deleteChapter(id: string) {
  const { error } = await supabase.from('chapters').delete().eq('id', id)
  throwIfError(error)
}

export async function reorderChapters(bookId: string, ids: string[]) {
  const { error } = await supabase.rpc('reorder_chapters', { p_book_id: bookId, p_ids: ids })
  throwIfError(error)
}

export async function createScene(bookId: string, chapterId: string, position: number, title: string): Promise<SceneMeta> {
  const { data, error } = await supabase
    .from('scenes')
    .insert({ book_id: bookId, chapter_id: chapterId, position, title })
    .select(SCENE_META_COLUMNS)
    .single()
  throwIfError(error)
  return data as SceneMeta
}

export async function renameScene(id: string, title: string) {
  const { error } = await supabase.from('scenes').update({ title }).eq('id', id)
  throwIfError(error)
}

export async function deleteScene(id: string) {
  const { error } = await supabase.from('scenes').delete().eq('id', id)
  throwIfError(error)
}

export async function reorderScenes(chapterId: string, ids: string[]) {
  const { error } = await supabase.rpc('reorder_scenes', { p_chapter_id: chapterId, p_ids: ids })
  throwIfError(error)
}

export interface ScenePayload {
  content: TiptapDoc
  text: string
}

/** Save with optimistic concurrency. Throws ConflictError if the scene changed elsewhere. */
export async function saveScene(sceneId: string, payload: ScenePayload, expectedRevision: number): Promise<SaveResult> {
  const { data, error } = await supabase.rpc('save_scene', {
    p_scene_id: sceneId,
    p_content: payload.content,
    p_content_text: payload.text,
    p_expected_revision: expectedRevision,
  })
  if (error) {
    if (error.message.includes('REVISION_CONFLICT')) throw new ConflictError()
    throwIfError(error)
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new AppError('Save returned no result')
  return row as SaveResult
}

export async function createCheckpoint(sceneId: string, label: string | null) {
  const { error } = await supabase.rpc('create_scene_checkpoint', { p_scene_id: sceneId, p_label: label })
  throwIfError(error)
}

export async function listVersions(sceneId: string): Promise<SceneVersion[]> {
  const { data, error } = await supabase
    .from('scene_versions')
    .select('id, scene_id, revision, content, content_text, word_count, kind, label, created_at')
    .eq('scene_id', sceneId)
    .order('created_at', { ascending: false })
    .limit(50)
  throwIfError(error)
  return (data ?? []) as SceneVersion[]
}

export async function restoreVersion(versionId: string, expectedRevision: number): Promise<SaveResult> {
  const { data, error } = await supabase.rpc('restore_scene_version', {
    p_version_id: versionId,
    p_expected_revision: expectedRevision,
  })
  if (error) {
    if (error.message.includes('REVISION_CONFLICT')) throw new ConflictError()
    throwIfError(error)
  }
  const row = Array.isArray(data) ? data[0] : data
  return row as SaveResult
}

export async function lastEditedScene() {
  const { data, error } = await supabase
    .from('scenes')
    .select('id, title, book_id, chapter_id, last_edited_at, books(title, archived_at), chapters(title)')
    .not('last_edited_at', 'is', null)
    .order('last_edited_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  throwIfError(error)
  return data as unknown as {
    id: string
    title: string
    book_id: string
    chapter_id: string
    last_edited_at: string
    books: { title: string; archived_at: string | null } | null
    chapters: { title: string } | null
  } | null
}
