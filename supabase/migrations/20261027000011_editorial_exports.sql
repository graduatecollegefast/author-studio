-- Phase 5: editorial studio, exports with download history, project backup and restore,
-- and account deletion.

-- ---------------------------------------------------------------------------
-- Exports: what was exported, with which options, and the file it produced.
-- Restores of a backup are recorded here too (export_type 'restore').
-- ---------------------------------------------------------------------------
alter table public.exports
  add column options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  add column file_name text,
  add column size_bytes bigint,
  add column result jsonb,
  add column completed_at timestamptz,
  drop constraint exports_status_check,
  add constraint exports_status_check check (status in ('pending', 'processing', 'completed', 'failed'));
create index exports_owner_idx on public.exports (owner_id, created_at desc);

-- Private bucket for exported files and uploaded backups, one folder per author.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('exports', 'exports', false, 524288000, array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/epub+zip',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/json',
    'application/zip',
    'application/x-zip-compressed'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "export files: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "export files: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "export files: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "export files: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- ---------------------------------------------------------------------------
-- Editorial findings link to the chapter they reviewed; proposals are their revisions.
-- ---------------------------------------------------------------------------
create index revision_proposals_finding_idx on public.revision_proposals (finding_id);

-- ---------------------------------------------------------------------------
-- Account deletion. Deletes the signed-in user; every author table cascades from it.
-- The app removes the author's stored files first, then calls this.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN' using errcode = 'PT401';
  end if;
  delete from auth.users where id = v_uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
