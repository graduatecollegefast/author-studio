-- Author Studio AI: core schema
-- Every author-owned row carries owner_id. Child rows reference parents through
-- composite (id, owner_id) foreign keys so a row can never point at a parent that
-- belongs to a different author, even though FK checks bypass RLS.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.count_words(p_text text)
returns integer language sql immutable set search_path = '' as $$
  select case
    when p_text is null or btrim(p_text) = '' then 0
    else coalesce(array_length(regexp_split_to_array(btrim(p_text), '\s+'), 1), 0)
  end
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  pen_names text[] not null default '{}',
  theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Universes, series, books
-- ---------------------------------------------------------------------------
create table public.universes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  universe_id uuid,
  name text not null check (length(btrim(name)) > 0),
  description text,
  genre text,
  planned_book_count integer check (planned_book_count is null or planned_book_count >= 0),
  status text not null default 'active' check (status in ('planning', 'active', 'complete', 'on_hold', 'archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete set null (universe_id)
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  subtitle text,
  pen_name text,
  description text,
  synopsis text,
  genre text,
  subgenre text,
  tropes text[] not null default '{}',
  themes text[] not null default '{}',
  book_type text not null default 'standalone_novel' check (book_type in (
    'published_novel', 'unpublished_manuscript', 'work_in_progress', 'standalone_novel',
    'series_installment', 'prequel', 'sequel', 'spin_off', 'short_story', 'novella',
    'anthology', 'archived_manuscript')),
  content_rating text not null default 'general' check (content_rating in ('general', 'teen', 'mature', 'adults_only')),
  publication_status text not null default 'unpublished' check (publication_status in (
    'unpublished', 'submitted', 'self_published', 'traditionally_published', 'out_of_print')),
  writing_status text not null default 'planning' check (writing_status in (
    'idea', 'planning', 'drafting', 'revising', 'editing', 'complete')),
  cover_path text,
  original_manuscript_file_id uuid,
  current_manuscript_file_id uuid,
  word_count integer not null default 0,
  target_word_count integer check (target_word_count is null or target_word_count >= 0),
  publication_date date,
  chronological_position numeric,
  author_notes text,
  archived_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(subtitle, '') || ' ' || coalesce(pen_name, '') || ' ' ||
      coalesce(genre, '') || ' ' || coalesce(subgenre, '') || ' ' || coalesce(description, '') || ' ' ||
      coalesce(synopsis, ''))
  ) stored,
  unique (id, owner_id)
);
create index books_owner_idx on public.books (owner_id, updated_at desc);
create index books_search_idx on public.books using gin (search);

create table public.series_books (
  series_id uuid not null,
  book_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reading_order integer,
  chronological_order integer,
  publication_order integer,
  created_at timestamptz not null default now(),
  primary key (series_id, book_id),
  foreign key (series_id, owner_id) references public.series (id, owner_id) on delete cascade,
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade
);
create index series_books_book_idx on public.series_books (book_id);

create table public.book_universes (
  book_id uuid not null,
  universe_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (book_id, universe_id),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete cascade
);
create index book_universes_universe_idx on public.book_universes (universe_id);

-- ---------------------------------------------------------------------------
-- Manuscript files
-- ---------------------------------------------------------------------------
create table public.manuscript_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null,
  kind text not null default 'manuscript' check (kind in ('manuscript', 'supporting')),
  storage_bucket text not null default 'manuscripts' check (storage_bucket = 'manuscripts'),
  storage_path text not null unique,
  original_name text not null,
  file_ext text not null check (file_ext in ('docx', 'pdf', 'epub', 'txt', 'md')),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  version integer not null default 1,
  upload_status text not null default 'pending' check (upload_status in ('pending', 'uploaded', 'validated', 'rejected', 'failed')),
  extraction_status text not null default 'not_started' check (extraction_status in ('not_started', 'queued', 'processing', 'completed', 'failed', 'needs_ocr')),
  analysis_status text not null default 'not_started' check (analysis_status in ('not_started', 'queued', 'processing', 'completed', 'failed')),
  error_message text,
  sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint manuscript_files_book_fk foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  -- The storage path must live under the owner's own folder.
  check (storage_path like owner_id::text || '/%')
);
create index manuscript_files_book_idx on public.manuscript_files (book_id, created_at desc);
create index manuscript_files_owner_idx on public.manuscript_files (owner_id, created_at desc);

alter table public.books
  add foreign key (original_manuscript_file_id, owner_id)
    references public.manuscript_files (id, owner_id) on delete set null (original_manuscript_file_id),
  add foreign key (current_manuscript_file_id, owner_id)
    references public.manuscript_files (id, owner_id) on delete set null (current_manuscript_file_id);

-- ---------------------------------------------------------------------------
-- Chapters, scenes, versions
-- ---------------------------------------------------------------------------
create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null,
  title text not null default 'Untitled Chapter',
  position integer not null default 0,
  summary text,
  word_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade
);
create index chapters_book_idx on public.chapters (book_id, position);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null,
  chapter_id uuid not null,
  title text not null default 'Scene',
  position integer not null default 0,
  summary text,
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  content_text text not null default '',
  word_count integer not null default 0,
  revision integer not null default 1,
  pov_character_id uuid,
  last_edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('english', coalesce(content_text, ''))) stored,
  unique (id, owner_id),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (chapter_id, owner_id) references public.chapters (id, owner_id) on delete cascade
);
create index scenes_chapter_idx on public.scenes (chapter_id, position);
create index scenes_book_idx on public.scenes (book_id);
create index scenes_last_edited_idx on public.scenes (owner_id, last_edited_at desc nulls last);
create index scenes_search_idx on public.scenes using gin (search);

-- A scene must belong to a chapter of the same book.
create or replace function public.scenes_check_chapter_book()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.chapters c where c.id = new.chapter_id and c.book_id = new.book_id) then
    raise exception 'Scene chapter does not belong to the scene book';
  end if;
  return new;
end $$;
create trigger scenes_check_chapter_book
  before insert or update of chapter_id, book_id on public.scenes
  for each row execute function public.scenes_check_chapter_book();

create table public.scene_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scene_id uuid not null,
  revision integer not null,
  content jsonb not null,
  content_text text not null default '',
  word_count integer not null default 0,
  kind text not null check (kind in ('autosnapshot', 'checkpoint', 'pre_restore', 'ai_accept', 'import')),
  label text,
  created_at timestamptz not null default now(),
  foreign key (scene_id, owner_id) references public.scenes (id, owner_id) on delete cascade
);
create index scene_versions_scene_idx on public.scene_versions (scene_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Story Bible: characters, relationships, world, timeline, canon
-- ---------------------------------------------------------------------------
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  universe_id uuid,
  full_name text not null check (length(btrim(full_name)) > 0),
  preferred_name text,
  nicknames text[] not null default '{}',
  aliases text[] not null default '{}',
  pronouns text,
  gender_identity text,
  sexual_orientation text,
  romantic_orientation text,
  date_of_birth text,
  age text,
  occupation text,
  education text,
  role text,
  appearance jsonb not null default '{}'::jsonb,
  personality jsonb not null default '{}'::jsonb,
  history jsonb not null default '{}'::jsonb,
  custom_fields jsonb not null default '{}'::jsonb,
  notes text,
  first_appearance_book_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('english', coalesce(full_name, '') || ' ' || coalesce(preferred_name, '') || ' ' ||
      coalesce(occupation, '') || ' ' || coalesce(role, '') || ' ' || coalesce(notes, ''))
  ) stored,
  unique (id, owner_id),
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete set null (universe_id),
  foreign key (first_appearance_book_id, owner_id) references public.books (id, owner_id) on delete set null (first_appearance_book_id)
);
create index characters_owner_idx on public.characters (owner_id, full_name);
create index characters_search_idx on public.characters using gin (search);

alter table public.scenes
  add foreign key (pov_character_id, owner_id) references public.characters (id, owner_id) on delete set null (pov_character_id);

create table public.character_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  character_id uuid not null,
  book_id uuid,
  attribute text not null,
  value text not null,
  period_label text,
  valid_from_position numeric,
  valid_to_position numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (character_id, owner_id) references public.characters (id, owner_id) on delete cascade,
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade
);
create index character_states_character_idx on public.character_states (character_id, attribute);

create table public.character_appearances (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  character_id uuid not null,
  book_id uuid not null,
  chapter_id uuid,
  scene_id uuid,
  role text,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (character_id, owner_id) references public.characters (id, owner_id) on delete cascade,
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (chapter_id, owner_id) references public.chapters (id, owner_id) on delete cascade,
  foreign key (scene_id, owner_id) references public.scenes (id, owner_id) on delete cascade
);
create index character_appearances_character_idx on public.character_appearances (character_id);
create index character_appearances_book_idx on public.character_appearances (book_id);

create table public.relationship_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  universe_id uuid,
  name text not null,
  structure_type text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete set null (universe_id)
);

create table public.relationship_group_members (
  group_id uuid not null,
  character_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  member_role text,
  primary key (group_id, character_id),
  foreign key (group_id, owner_id) references public.relationship_groups (id, owner_id) on delete cascade,
  foreign key (character_id, owner_id) references public.characters (id, owner_id) on delete cascade
);

create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  character_a_id uuid not null,
  character_b_id uuid,
  group_id uuid,
  category text not null check (category in (
    'romantic', 'sexual', 'married', 'former_partner', 'family', 'friendship', 'professional',
    'rivalry', 'conflict', 'mentorship', 'custom')),
  custom_label text,
  description text,
  current_status text,
  start_period text,
  end_period text,
  start_book_id uuid,
  end_book_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (character_b_id is not null or group_id is not null),
  check (character_b_id is null or character_a_id <> character_b_id),
  foreign key (character_a_id, owner_id) references public.characters (id, owner_id) on delete cascade,
  foreign key (character_b_id, owner_id) references public.characters (id, owner_id) on delete cascade,
  foreign key (group_id, owner_id) references public.relationship_groups (id, owner_id) on delete cascade,
  foreign key (start_book_id, owner_id) references public.books (id, owner_id) on delete set null (start_book_id),
  foreign key (end_book_id, owner_id) references public.books (id, owner_id) on delete set null (end_book_id)
);
create index relationships_a_idx on public.relationships (character_a_id);
create index relationships_b_idx on public.relationships (character_b_id);

create table public.world_elements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  universe_id uuid,
  name text not null check (length(btrim(name)) > 0),
  category text not null,
  description text,
  history text,
  rules text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(category, '') || ' ' ||
      coalesce(description, '') || ' ' || coalesce(history, '') || ' ' || coalesce(rules, ''))
  ) stored,
  unique (id, owner_id),
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete set null (universe_id)
);
create index world_elements_search_idx on public.world_elements using gin (search);
create unique index world_elements_unique_name on public.world_elements (owner_id, coalesce(universe_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name), category);

create table public.story_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  universe_id uuid,
  series_id uuid,
  book_id uuid,
  chapter_id uuid,
  location_element_id uuid,
  title text not null,
  description text,
  event_type text,
  date_precision text not null default 'unknown' check (date_precision in ('exact', 'approximate', 'unknown', 'relative')),
  date_start date,
  date_end date,
  approximate_label text,
  chronological_order numeric,
  reveal_order numeric,
  is_flashback boolean not null default false,
  reliability text not null default 'confirmed' check (reliability in ('confirmed', 'uncertain', 'unreliable_narration')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete set null (universe_id),
  foreign key (series_id, owner_id) references public.series (id, owner_id) on delete set null (series_id),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (chapter_id, owner_id) references public.chapters (id, owner_id) on delete set null (chapter_id),
  foreign key (location_element_id, owner_id) references public.world_elements (id, owner_id) on delete set null (location_element_id)
);
create index story_events_book_idx on public.story_events (book_id, chronological_order);

create table public.story_event_characters (
  event_id uuid not null,
  character_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (event_id, character_id),
  foreign key (event_id, owner_id) references public.story_events (id, owner_id) on delete cascade,
  foreign key (character_id, owner_id) references public.characters (id, owner_id) on delete cascade
);

create table public.world_element_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  world_element_id uuid not null,
  book_id uuid,
  series_id uuid,
  character_id uuid,
  story_event_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(book_id, series_id, character_id, story_event_id) = 1),
  foreign key (world_element_id, owner_id) references public.world_elements (id, owner_id) on delete cascade,
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (series_id, owner_id) references public.series (id, owner_id) on delete cascade,
  foreign key (character_id, owner_id) references public.characters (id, owner_id) on delete cascade,
  foreign key (story_event_id, owner_id) references public.story_events (id, owner_id) on delete cascade
);
create index world_element_links_element_idx on public.world_element_links (world_element_id);

create table public.plot_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  universe_id uuid,
  series_id uuid,
  book_id uuid,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'resolved', 'abandoned')),
  opened_in_book_id uuid,
  resolved_in_book_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete set null (universe_id),
  foreign key (series_id, owner_id) references public.series (id, owner_id) on delete cascade,
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (opened_in_book_id, owner_id) references public.books (id, owner_id) on delete set null (opened_in_book_id),
  foreign key (resolved_in_book_id, owner_id) references public.books (id, owner_id) on delete set null (resolved_in_book_id)
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  manuscript_file_id uuid not null,
  book_id uuid not null,
  chunk_index integer not null,
  chapter_label text,
  content text not null,
  char_start integer not null,
  char_end integer not null,
  token_estimate integer,
  analysis_status text not null default 'pending' check (analysis_status in ('pending', 'processing', 'completed', 'failed')),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored,
  unique (id, owner_id),
  unique (manuscript_file_id, chunk_index),
  foreign key (manuscript_file_id, owner_id) references public.manuscript_files (id, owner_id) on delete cascade,
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade
);
create index document_chunks_search_idx on public.document_chunks using gin (search);

create table public.canon_facts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  universe_id uuid,
  book_id uuid,
  entity_type text not null check (entity_type in ('character', 'relationship', 'world_element', 'story_event', 'plot_thread', 'book', 'series', 'universe')),
  entity_id uuid,
  entity_label text,
  attribute text not null,
  value text not null,
  statement_type text not null default 'ai_inference' check (statement_type in (
    'author_confirmed', 'narrator', 'character_statement', 'character_belief', 'rumor', 'dream',
    'flashback', 'ai_inference', 'ai_suggestion')),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'superseded', 'provisional')),
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  valid_from_book_id uuid,
  valid_to_book_id uuid,
  valid_period_label text,
  approved_at timestamptz,
  superseded_by uuid references public.canon_facts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete set null (universe_id),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (valid_from_book_id, owner_id) references public.books (id, owner_id) on delete set null (valid_from_book_id),
  foreign key (valid_to_book_id, owner_id) references public.books (id, owner_id) on delete set null (valid_to_book_id)
);
create index canon_facts_entity_idx on public.canon_facts (entity_type, entity_id, status);
create index canon_facts_owner_status_idx on public.canon_facts (owner_id, status);

create table public.fact_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fact_id uuid not null,
  manuscript_file_id uuid,
  book_id uuid,
  chapter_id uuid,
  scene_id uuid,
  chunk_id uuid,
  location_label text,
  excerpt text,
  char_start integer,
  char_end integer,
  created_at timestamptz not null default now(),
  foreign key (fact_id, owner_id) references public.canon_facts (id, owner_id) on delete cascade,
  foreign key (manuscript_file_id, owner_id) references public.manuscript_files (id, owner_id) on delete cascade,
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (chapter_id, owner_id) references public.chapters (id, owner_id) on delete set null (chapter_id),
  foreign key (scene_id, owner_id) references public.scenes (id, owner_id) on delete set null (scene_id),
  foreign key (chunk_id, owner_id) references public.document_chunks (id, owner_id) on delete set null (chunk_id)
);
create index fact_sources_fact_idx on public.fact_sources (fact_id);

create table public.writing_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scope text not null check (scope in ('author', 'pen_name', 'series', 'book')),
  name text not null,
  pen_name text,
  series_id uuid,
  book_id uuid,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (series_id, owner_id) references public.series (id, owner_id) on delete cascade,
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade
);

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text,
  category text not null default 'general_note' check (category in (
    'book_idea', 'character_idea', 'plot_twist', 'dialogue', 'scene', 'setting', 'relationship',
    'theme', 'ending', 'spin_off', 'general_note')),
  tags text[] not null default '{}',
  status text not null default 'new' check (status in ('new', 'developing', 'used', 'archived')),
  book_id uuid,
  series_id uuid,
  universe_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete set null (book_id),
  foreign key (series_id, owner_id) references public.series (id, owner_id) on delete set null (series_id),
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete set null (universe_id)
);

create table public.idea_characters (
  idea_id uuid not null,
  character_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (idea_id, character_id),
  foreign key (idea_id, owner_id) references public.ideas (id, owner_id) on delete cascade,
  foreign key (character_id, owner_id) references public.characters (id, owner_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- AI conversations, tasks, questions, editorial work, exports, usage
-- ---------------------------------------------------------------------------
create table public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  idempotency_key text not null,
  book_id uuid,
  manuscript_file_id uuid,
  total_steps integer not null default 0,
  completed_steps integer not null default 0,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  attempts integer not null default 0,
  estimated_cost_usd numeric(12, 6),
  actual_cost_usd numeric(12, 6),
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, idempotency_key),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (manuscript_file_id, owner_id) references public.manuscript_files (id, owner_id) on delete cascade
);
create index ai_tasks_status_idx on public.ai_tasks (owner_id, status, created_at desc);

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid,
  title text,
  mode text check (mode in ('assistant', 'co_writer', 'creative_partner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, owner_id) references public.ai_conversations (id, owner_id) on delete cascade
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

create table public.clarification_questions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid,
  series_id uuid,
  universe_id uuid,
  ai_task_id uuid,
  question text not null,
  context text,
  options jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'answered', 'skipped', 'saved_for_later', 'ai_decided')),
  answer text,
  is_provisional boolean not null default false,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (series_id, owner_id) references public.series (id, owner_id) on delete cascade,
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete cascade,
  foreign key (ai_task_id, owner_id) references public.ai_tasks (id, owner_id) on delete set null (ai_task_id)
);
create index clarification_questions_status_idx on public.clarification_questions (owner_id, status);

create table public.editorial_findings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null,
  chapter_id uuid,
  scene_id uuid,
  ai_task_id uuid,
  review_type text not null check (review_type in ('developmental', 'line', 'copy', 'dialogue', 'continuity', 'reader')),
  category text,
  severity text not null default 'suggestion' check (severity in ('critical', 'warning', 'suggestion')),
  description text not null,
  original_evidence text,
  conflicting_evidence text,
  suggested_resolution text,
  status text not null default 'open' check (status in ('open', 'accepted', 'intentional', 'dismissed', 'saved_for_later')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (chapter_id, owner_id) references public.chapters (id, owner_id) on delete cascade,
  foreign key (scene_id, owner_id) references public.scenes (id, owner_id) on delete cascade,
  foreign key (ai_task_id, owner_id) references public.ai_tasks (id, owner_id) on delete set null (ai_task_id)
);
create index editorial_findings_status_idx on public.editorial_findings (owner_id, review_type, status);

create table public.revision_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scene_id uuid not null,
  finding_id uuid,
  ai_task_id uuid,
  base_revision integer not null,
  original_text text not null,
  proposed_text text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'edited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (scene_id, owner_id) references public.scenes (id, owner_id) on delete cascade,
  foreign key (finding_id, owner_id) references public.editorial_findings (id, owner_id) on delete cascade,
  foreign key (ai_task_id, owner_id) references public.ai_tasks (id, owner_id) on delete set null (ai_task_id)
);

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid,
  export_type text not null,
  format text not null check (format in ('docx', 'epub', 'pdf', 'txt', 'md', 'json', 'zip')),
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ai_task_id uuid,
  provider text not null,
  model text not null,
  task_type text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now(),
  foreign key (ai_task_id, owner_id) references public.ai_tasks (id, owner_id) on delete set null (ai_task_id)
);
create index ai_usage_owner_idx on public.ai_usage (owner_id, created_at desc);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_owner_idx on public.activity_log (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'universes', 'series', 'books', 'manuscript_files', 'chapters', 'scenes', 'characters',
    'character_states', 'relationship_groups', 'relationships', 'world_elements', 'story_events',
    'plot_threads', 'canon_facts', 'writing_profiles', 'ideas', 'ai_tasks', 'ai_conversations',
    'editorial_findings', 'revision_proposals']
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
