-- Re-importing a manuscript after improved extraction.
-- Chapters remember which file they were imported from, so a re-import can
-- replace them. Chapters the author has edited since importing are never removed.

alter table public.chapters add column source_manuscript_file_id uuid;
alter table public.chapters
  add constraint chapters_source_file_fk foreign key (source_manuscript_file_id, owner_id)
  references public.manuscript_files (id, owner_id) on delete set null (source_manuscript_file_id);
create index chapters_source_file_idx on public.chapters (source_manuscript_file_id);

-- Earlier imports ran in one transaction, so their chapters share the file's imported_at timestamp.
update public.chapters c
   set source_manuscript_file_id = f.id
  from public.manuscript_files f
 where f.imported_at is not null
   and c.book_id = f.book_id
   and c.created_at = f.imported_at
   and c.source_manuscript_file_id is null;

alter table public.manuscript_extractions add column cleanup jsonb;

drop function if exists public.import_manuscript(uuid, jsonb);

create or replace function public.import_manuscript(p_file_id uuid, p_chapters jsonb, p_replace boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_book uuid;
  v_pos integer;
  v_chapter uuid;
  v_ch jsonb;
  v_sc jsonb;
  v_scene_pos integer;
  v_count integer := 0;
  v_replaced integer := 0;
  v_kept integer := 0;
begin
  select book_id into v_book from public.manuscript_files where id = p_file_id;
  if v_book is null then
    raise exception 'FILE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if jsonb_typeof(p_chapters) <> 'array' or jsonb_array_length(p_chapters) = 0 or jsonb_array_length(p_chapters) > 1000 then
    raise exception 'INVALID_IMPORT' using errcode = '22023';
  end if;

  if p_replace then
    -- Keep any chapter whose scenes were edited after import; remove the rest.
    select count(*) into v_kept from public.chapters c
     where c.source_manuscript_file_id = p_file_id
       and exists (select 1 from public.scenes s where s.chapter_id = c.id and s.last_edited_at is not null);
    with gone as (
      delete from public.chapters c
       where c.source_manuscript_file_id = p_file_id
         and not exists (select 1 from public.scenes s where s.chapter_id = c.id and s.last_edited_at is not null)
      returning 1
    ) select count(*) into v_replaced from gone;
    -- Close the gaps left in chapter order.
    update public.chapters c set position = o.rn - 1
      from (select id, row_number() over (order by position, created_at) as rn from public.chapters where book_id = v_book) o
     where c.id = o.id and c.position <> o.rn - 1;
  end if;

  select coalesce(max(position), -1) + 1 into v_pos from public.chapters where book_id = v_book;

  for v_ch in select * from jsonb_array_elements(p_chapters) loop
    insert into public.chapters (book_id, title, position, source_manuscript_file_id)
    values (v_book, left(coalesce(nullif(btrim(v_ch ->> 'title'), ''), 'Chapter ' || (v_pos + 1)), 200), v_pos, p_file_id)
    returning id into v_chapter;
    v_pos := v_pos + 1;
    v_count := v_count + 1;
    v_scene_pos := 0;

    for v_sc in select * from jsonb_array_elements(coalesce(v_ch -> 'scenes', '[]'::jsonb)) loop
      if v_sc -> 'content' ->> 'type' is distinct from 'doc' then
        raise exception 'INVALID_CONTENT' using errcode = '22023';
      end if;
      insert into public.scenes (book_id, chapter_id, title, position, content, content_text, word_count)
      values (v_book, v_chapter, left(coalesce(nullif(btrim(v_sc ->> 'title'), ''), 'Scene ' || (v_scene_pos + 1)), 200),
              v_scene_pos, v_sc -> 'content', coalesce(v_sc ->> 'text', ''), public.count_words(v_sc ->> 'text'));
      v_scene_pos := v_scene_pos + 1;
    end loop;

    if v_scene_pos = 0 then
      insert into public.scenes (book_id, chapter_id, title, position) values (v_book, v_chapter, 'Scene 1', 0);
    end if;
  end loop;

  update public.manuscript_files set imported_at = now() where id = p_file_id;
  return jsonb_build_object('imported', v_count, 'replaced', v_replaced, 'kept', v_kept);
end $$;

revoke all on function public.import_manuscript(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_manuscript(uuid, jsonb, boolean) to authenticated;
