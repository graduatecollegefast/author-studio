-- Row-level security, storage buckets and storage policies.

-- ---------------------------------------------------------------------------
-- Table privileges: only signed-in users reach author data. anon gets nothing.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Append-only audit/usage tables
revoke update, delete on public.ai_usage, public.activity_log from authenticated;
-- Profiles are created by trigger and removed with the auth user
revoke insert, delete on public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy "profiles: owner can read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: owner can update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array[
    'universes', 'series', 'books', 'series_books', 'book_universes', 'manuscript_files', 'chapters',
    'scenes', 'scene_versions', 'characters', 'character_states', 'character_appearances',
    'relationship_groups', 'relationship_group_members', 'relationships', 'world_elements',
    'world_element_links', 'story_events', 'story_event_characters', 'plot_threads', 'document_chunks',
    'canon_facts', 'fact_sources', 'writing_profiles', 'ideas', 'idea_characters', 'ai_tasks',
    'ai_conversations', 'ai_messages', 'clarification_questions', 'editorial_findings',
    'revision_proposals', 'exports']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "owner full access" on public.%I for all to authenticated
         using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
  end loop;

  foreach t in array array['ai_usage', 'activity_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner can read" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create policy "owner can insert" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t);
  end loop;
end $$;

-- owner_id must never change after insert (prevents moving rows between accounts)
create or replace function public.prevent_owner_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id cannot be changed';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'owner_id' and tb.table_type = 'BASE TABLE'
  loop
    execute format('create trigger prevent_owner_change before update on public.%I for each row execute function public.prevent_owner_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: private buckets, files live under "<user id>/..."
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('manuscripts', 'manuscripts', false, 104857600, array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf',
    'application/epub+zip',
    'text/plain',
    'text/markdown']),
  ('covers', 'covers', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "author files: read own" on storage.objects
  for select to authenticated
  using (bucket_id in ('manuscripts', 'covers') and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "author files: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('manuscripts', 'covers') and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "author files: update own" on storage.objects
  for update to authenticated
  using (bucket_id in ('manuscripts', 'covers') and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id in ('manuscripts', 'covers') and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "author files: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id in ('manuscripts', 'covers') and (storage.foldername(name))[1] = (select auth.uid()::text));
