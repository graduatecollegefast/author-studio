-- Phase 2: extracted manuscript structure, and importing it into chapters.

alter table public.manuscript_files
  add column extracted_at timestamptz,
  add column imported_at timestamptz;

create table public.manuscript_extractions (
  manuscript_file_id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null,
  format text not null check (format in ('docx', 'pdf', 'epub', 'txt', 'md')),
  detected_title text,
  word_count integer not null default 0,
  character_count integer not null default 0,
  page_count integer,
  chapter_count integer not null default 0,
  -- Normalized chapters, scenes and paragraphs (text, bold, italic only). Never raw HTML.
  structure jsonb not null default '[]'::jsonb,
  warnings text[] not null default '{}',
  needs_ocr boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (manuscript_file_id, owner_id) references public.manuscript_files (id, owner_id) on delete cascade,
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade
);

alter table public.manuscript_extractions enable row level security;
create policy "owner full access" on public.manuscript_extractions for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.manuscript_extractions from anon;
grant select, insert, update, delete on public.manuscript_extractions to authenticated;
create trigger prevent_owner_change before update on public.manuscript_extractions
  for each row execute function public.prevent_owner_change();

create index document_chunks_file_idx on public.document_chunks (manuscript_file_id, chunk_index);

-- Import extracted chapters after the book's existing chapters, in one transaction.
-- p_chapters: [{ "title": text, "scenes": [{ "title": text, "content": tiptap doc, "text": text }] }]
create or replace function public.import_manuscript(p_file_id uuid, p_chapters jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_book uuid;
  v_pos integer;
  v_chapter uuid;
  v_ch jsonb;
  v_sc jsonb;
  v_scene_pos integer;
  v_count integer := 0;
begin
  select book_id into v_book from public.manuscript_files where id = p_file_id;
  if v_book is null then
    raise exception 'FILE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if jsonb_typeof(p_chapters) <> 'array' or jsonb_array_length(p_chapters) = 0 or jsonb_array_length(p_chapters) > 1000 then
    raise exception 'INVALID_IMPORT' using errcode = '22023';
  end if;

  select coalesce(max(position), -1) + 1 into v_pos from public.chapters where book_id = v_book;

  for v_ch in select * from jsonb_array_elements(p_chapters) loop
    insert into public.chapters (book_id, title, position)
    values (v_book, left(coalesce(nullif(btrim(v_ch ->> 'title'), ''), 'Chapter ' || (v_pos + 1)), 200), v_pos)
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
  return v_count;
end $$;

revoke all on function public.import_manuscript(uuid, jsonb) from public, anon;
grant execute on function public.import_manuscript(uuid, jsonb) to authenticated;
