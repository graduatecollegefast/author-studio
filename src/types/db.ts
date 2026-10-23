// Row shapes for the Phase 1 tables. Mirrors supabase/migrations.

export const BOOK_TYPES = [
  'published_novel',
  'unpublished_manuscript',
  'work_in_progress',
  'standalone_novel',
  'series_installment',
  'prequel',
  'sequel',
  'spin_off',
  'short_story',
  'novella',
  'anthology',
  'archived_manuscript',
] as const
export type BookType = (typeof BOOK_TYPES)[number]

export const CONTENT_RATINGS = ['general', 'teen', 'mature', 'adults_only'] as const
export type ContentRating = (typeof CONTENT_RATINGS)[number]

export const PUBLICATION_STATUSES = [
  'unpublished',
  'submitted',
  'self_published',
  'traditionally_published',
  'out_of_print',
] as const
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]

export const WRITING_STATUSES = ['idea', 'planning', 'drafting', 'revising', 'editing', 'complete'] as const
export type WritingStatus = (typeof WRITING_STATUSES)[number]

export interface Profile {
  id: string
  display_name: string | null
  pen_names: string[]
  theme: 'dark' | 'light' | 'system'
  preferences: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Book {
  id: string
  owner_id: string
  title: string
  subtitle: string | null
  pen_name: string | null
  description: string | null
  synopsis: string | null
  genre: string | null
  subgenre: string | null
  tropes: string[]
  themes: string[]
  book_type: BookType
  content_rating: ContentRating
  publication_status: PublicationStatus
  writing_status: WritingStatus
  cover_path: string | null
  original_manuscript_file_id: string | null
  current_manuscript_file_id: string | null
  ai_mode: 'assistant' | 'co_writer' | 'creative_partner'
  style_profile_id: string | null
  word_count: number
  target_word_count: number | null
  publication_date: string | null
  chronological_position: number | null
  author_notes: string | null
  story_start_date: string | null
  archived_at: string | null
  last_opened_at: string | null
  created_at: string
  updated_at: string
}

export type UploadStatus = 'pending' | 'uploaded' | 'validated' | 'rejected' | 'failed'
export type ProcessingStatus = 'not_started' | 'queued' | 'processing' | 'completed' | 'failed' | 'needs_ocr'

export interface ManuscriptFile {
  id: string
  owner_id: string
  book_id: string
  kind: 'manuscript' | 'supporting'
  storage_bucket: 'manuscripts'
  storage_path: string
  original_name: string
  file_ext: 'docx' | 'pdf' | 'epub' | 'txt' | 'md'
  mime_type: string
  size_bytes: number
  version: number
  upload_status: UploadStatus
  extraction_status: ProcessingStatus
  analysis_status: Exclude<ProcessingStatus, 'needs_ocr'>
  error_message: string | null
  sha256: string | null
  extracted_at: string | null
  imported_at: string | null
  created_at: string
  updated_at: string
}

export interface Chapter {
  id: string
  owner_id: string
  book_id: string
  title: string
  position: number
  summary: string | null
  word_count: number
  story_date: string | null
  story_date_text: string | null
  story_date_source: 'detected' | 'author' | null
  created_at: string
  updated_at: string
}

export interface TiptapDoc {
  type: 'doc'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors TipTap's JSONContent
  content?: Array<Record<string, any>>
}

export interface Scene {
  id: string
  owner_id: string
  book_id: string
  chapter_id: string
  title: string
  position: number
  summary: string | null
  content: TiptapDoc
  content_text: string
  word_count: number
  revision: number
  last_edited_at: string | null
  created_at: string
  updated_at: string
}

export type SceneMeta = Omit<Scene, 'content' | 'content_text'>

export interface SceneVersion {
  id: string
  scene_id: string
  revision: number
  content: TiptapDoc
  content_text: string
  word_count: number
  kind: 'autosnapshot' | 'checkpoint' | 'pre_restore' | 'ai_accept' | 'import'
  label: string | null
  created_at: string
}

export interface SaveResult {
  revision: number
  word_count: number
  updated_at: string
}
