-- Manuscript editing: safe saves, automatic version snapshots, checkpoints,
-- restore, and word-count rollups. All functions run as the calling user, so
-- row-level security still applies.

-- ---------------------------------------------------------------------------
-- Automatic snapshot of the previous content before it is overwritten.
-- Throttled to at most one automatic snapshot per scene every 10 minutes so
-- autosave does not flood history, while a recoverable prior version is always
-- kept for any edit session.
-- ---------------------------------------------------------------------------
create or replace function public.scenes_snapshot_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.content is distinct from old.content
     and old.content_text <> ''
     and not exists (
       select 1 from public.scene_versions v
       where v.scene_id = old.id and v.created_at > now() - interval '10 minutes'
     )
  then
    insert into public.scene_versions (owner_id, scene_id, revision, content, content_text, word_count, kind)
    values (old.owner_id, old.id, old.revision, old.content, old.content_text, old.word_count, 'autosnapshot');
  end if;
  return new;
end $$;

create trigger scenes_snapshot_before_update
  before update of content on public.scenes
  for each row execute function public.scenes_snapshot_before_update();

-- ---------------------------------------------------------------------------
-- Word-count rollups: scenes -> chapters -> books
-- ---------------------------------------------------------------------------
create or replace function public.rollup_word_counts()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_chapter uuid;
  v_book uuid;
begin
  v_chapter := coalesce(new.chapter_id, old.chapter_id);
  v_book := coalesce(new.book_id, old.book_id);

  update public.chapters c
     set word_count = coalesce((select sum(s.word_count) from public.scenes s where s.chapter_id = c.id), 0)
   where c.id = v_chapter;

  if tg_op = 'UPDATE' and old.chapter_id is distinct from new.chapter_id then
    update public.chapters c
       set word_count = coalesce((select sum(s.word_count) from public.scenes s where s.chapter_id = c.id), 0)
     where c.id = old.chapter_id;
  end if;

  update public.books b
     set word_count = coalesce((select sum(s.word_count) from public.scenes s where s.book_id = b.id), 0)
   where b.id = v_book;

  return null;
end $$;

create trigger scenes_rollup_word_counts
  after insert or delete or update of word_count, chapter_id on public.scenes
  for each row execute function public.rollup_word_counts();

-- ---------------------------------------------------------------------------
-- save_scene: optimistic-concurrency save used by autosave.
-- Fails with REVISION_CONFLICT if the scene changed since the editor loaded it.
-- ---------------------------------------------------------------------------
create or replace function public.save_scene(
  p_scene_id uuid,
  p_content jsonb,
  p_content_text text,
  p_expected_revision integer
)
returns table (revision integer, word_count integer, updated_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if p_content is null or p_content ->> 'type' is distinct from 'doc' then
    raise exception 'INVALID_CONTENT' using errcode = '22023';
  end if;

  return query
  update public.scenes s
     set content = p_content,
         content_text = coalesce(p_content_text, ''),
         word_count = public.count_words(p_content_text),
         revision = s.revision + 1,
         last_edited_at = now()
   where s.id = p_scene_id
     and s.revision = p_expected_revision
  returning s.revision, s.word_count, s.updated_at;

  if not found then
    if exists (select 1 from public.scenes s where s.id = p_scene_id) then
      raise exception 'REVISION_CONFLICT' using errcode = 'PT409';
    else
      raise exception 'SCENE_NOT_FOUND' using errcode = 'PT404';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Manual checkpoint of the current saved content
-- ---------------------------------------------------------------------------
create or replace function public.create_scene_checkpoint(p_scene_id uuid, p_label text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.scene_versions (owner_id, scene_id, revision, content, content_text, word_count, kind, label)
  select s.owner_id, s.id, s.revision, s.content, s.content_text, s.word_count, 'checkpoint', nullif(btrim(p_label), '')
    from public.scenes s where s.id = p_scene_id
  returning id into v_id;

  if v_id is null then
    raise exception 'SCENE_NOT_FOUND' using errcode = 'PT404';
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Restore a previous version. The current content is preserved first.
-- ---------------------------------------------------------------------------
create or replace function public.restore_scene_version(p_version_id uuid, p_expected_revision integer)
returns table (revision integer, word_count integer, updated_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare v record;
begin
  select * into v from public.scene_versions where id = p_version_id;
  if not found then
    raise exception 'VERSION_NOT_FOUND' using errcode = 'PT404';
  end if;

  insert into public.scene_versions (owner_id, scene_id, revision, content, content_text, word_count, kind, label)
  select s.owner_id, s.id, s.revision, s.content, s.content_text, s.word_count, 'pre_restore',
         'Before restoring revision ' || v.revision
    from public.scenes s
   where s.id = v.scene_id and s.revision = p_expected_revision;

  if not found then
    raise exception 'REVISION_CONFLICT' using errcode = 'PT409';
  end if;

  return query select * from public.save_scene(v.scene_id, v.content, v.content_text, p_expected_revision);
end $$;

-- ---------------------------------------------------------------------------
-- Create a chapter together with its first scene, appended to the book.
-- ---------------------------------------------------------------------------
create or replace function public.create_chapter(p_book_id uuid, p_title text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_chapter uuid;
  v_pos integer;
begin
  select coalesce(max(position), -1) + 1 into v_pos from public.chapters where book_id = p_book_id;

  insert into public.chapters (book_id, title, position)
  values (p_book_id, coalesce(nullif(btrim(p_title), ''), 'Chapter ' || (v_pos + 1)), v_pos)
  returning id into v_chapter;

  insert into public.scenes (book_id, chapter_id, title, position)
  values (p_book_id, v_chapter, 'Scene 1', 0);

  return v_chapter;
end $$;

-- ---------------------------------------------------------------------------
-- Reorder chapters or scenes in one statement. p_ids is the full new order.
-- ---------------------------------------------------------------------------
create or replace function public.reorder_chapters(p_book_id uuid, p_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.chapters where book_id = p_book_id) <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'REORDER_MISMATCH' using errcode = '22023';
  end if;
  update public.chapters c
     set position = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where c.id = o.id and c.book_id = p_book_id;
end $$;

create or replace function public.reorder_scenes(p_chapter_id uuid, p_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.scenes where chapter_id = p_chapter_id) <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'REORDER_MISMATCH' using errcode = '22023';
  end if;
  update public.scenes s
     set position = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where s.id = o.id and s.chapter_id = p_chapter_id;
end $$;

-- Deleting the last scene of a chapter is not allowed; delete the chapter instead.
create or replace function public.scenes_keep_one()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.chapters c where c.id = old.chapter_id)
     and not exists (select 1 from public.scenes s where s.chapter_id = old.chapter_id and s.id <> old.id)
     and pg_trigger_depth() = 1
  then
    raise exception 'LAST_SCENE' using errcode = '23514', hint = 'Delete the chapter instead.';
  end if;
  return old;
end $$;

create trigger scenes_keep_one
  before delete on public.scenes
  for each row execute function public.scenes_keep_one();

revoke all on function public.save_scene(uuid, jsonb, text, integer) from public, anon;
revoke all on function public.create_scene_checkpoint(uuid, text) from public, anon;
revoke all on function public.restore_scene_version(uuid, integer) from public, anon;
revoke all on function public.create_chapter(uuid, text) from public, anon;
revoke all on function public.reorder_chapters(uuid, uuid[]) from public, anon;
revoke all on function public.reorder_scenes(uuid, uuid[]) from public, anon;
grant execute on function public.save_scene(uuid, jsonb, text, integer) to authenticated;
grant execute on function public.create_scene_checkpoint(uuid, text) to authenticated;
grant execute on function public.restore_scene_version(uuid, integer) to authenticated;
grant execute on function public.create_chapter(uuid, text) to authenticated;
grant execute on function public.reorder_chapters(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_scenes(uuid, uuid[]) to authenticated;
