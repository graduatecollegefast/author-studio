-- Phase 4: AI writing partner, writing modes, style profiles, questions, ideas vault.

-- ---------------------------------------------------------------------------
-- Style profiles at author, pen name, series or book level.
-- ---------------------------------------------------------------------------
alter table public.writing_profiles
  add column universe_id uuid,
  add column summary text,
  add column preferences text,
  add column source_book_ids uuid[] not null default '{}',
  add column sample_words integer not null default 0,
  add column analyzed_at timestamptz,
  add constraint writing_profiles_id_owner_key unique (id, owner_id),
  add foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete set null (universe_id);
create index writing_profiles_owner_idx on public.writing_profiles (owner_id, scope);

-- ---------------------------------------------------------------------------
-- Per-book AI settings: mode, style profile for drafting, deliberate crossovers.
-- ---------------------------------------------------------------------------
alter table public.books
  add column ai_mode text not null default 'assistant' check (ai_mode in ('assistant', 'co_writer', 'creative_partner')),
  add column style_profile_id uuid,
  add foreign key (style_profile_id, owner_id) references public.writing_profiles (id, owner_id) on delete set null (style_profile_id);

-- Universes whose canon may be used for this book even though the book is not part of them.
create table public.book_crossovers (
  book_id uuid not null,
  universe_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (book_id, universe_id),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (universe_id, owner_id) references public.universes (id, owner_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- AI proposals from the Writing Studio. Nothing is inserted until the author accepts.
-- ---------------------------------------------------------------------------
alter table public.revision_proposals
  add column book_id uuid,
  add column command text,
  add column instruction text,
  add column insert_mode text not null default 'replace' check (insert_mode in ('replace', 'insert_after', 'append', 'new_scene', 'new_chapter', 'notes')),
  add column selection_from integer,
  add column selection_to integer,
  add column notes text,
  add column error text,
  add column model text,
  drop constraint revision_proposals_status_check,
  add constraint revision_proposals_status_check check (status in ('generating', 'pending', 'accepted', 'rejected', 'edited', 'failed')),
  alter column proposed_text set default '',
  add foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade;
create index revision_proposals_scene_idx on public.revision_proposals (scene_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Clarification questions: dedupe key, who answered, provisional decisions.
-- ---------------------------------------------------------------------------
alter table public.clarification_questions
  add column topic_key text,
  add column answered_by text check (answered_by is null or answered_by in ('author', 'ai')),
  add column chosen_option text,
  add column reasoning text,
  add column updated_at timestamptz not null default now(),
  add constraint clarification_questions_id_owner_key unique (id, owner_id);
create index clarification_questions_book_idx on public.clarification_questions (book_id, status);
create trigger set_updated_at before update on public.clarification_questions for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Creative Partner plans: premise, arcs, outline, chapter and scene plans.
-- ---------------------------------------------------------------------------
create table public.story_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null,
  ai_task_id uuid,
  kind text not null check (kind in ('concept', 'analysis', 'premise', 'character_arcs', 'outline', 'chapter', 'scene')),
  chapter_index integer,
  scene_index integer,
  title text not null default '',
  content text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved', 'drafted', 'redraft')),
  chapter_id uuid,
  scene_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade,
  foreign key (ai_task_id, owner_id) references public.ai_tasks (id, owner_id) on delete set null (ai_task_id),
  foreign key (chapter_id, owner_id) references public.chapters (id, owner_id) on delete set null (chapter_id),
  foreign key (scene_id, owner_id) references public.scenes (id, owner_id) on delete set null (scene_id)
);
create index story_plans_book_idx on public.story_plans (book_id, kind, chapter_index, scene_index);
create trigger set_updated_at before update on public.story_plans for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Ideas: AI-suggested connections and what an idea became.
-- ---------------------------------------------------------------------------
alter table public.ideas
  add column suggested_links jsonb not null default '[]'::jsonb check (jsonb_typeof(suggested_links) = 'array'),
  add column converted_entity_type text check (converted_entity_type is null or converted_entity_type in ('book', 'character', 'plot_thread', 'scene')),
  add column converted_entity_id uuid;
create index ideas_owner_idx on public.ideas (owner_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Privileges and row-level security for the new tables.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['book_crossovers', 'story_plans']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "owner full access" on public.%I for all to authenticated
         using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create trigger prevent_owner_change before update on public.%I for each row execute function public.prevent_owner_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Insert AI-drafted text as new scenes, never over existing ones.
-- With p_after_scene_id: new scenes go right after that scene in its chapter.
-- Otherwise: a new chapter titled p_chapter_title goes after p_after_chapter_id
-- (or at the end of the book) holding the scenes.
-- p_scenes: [{ "title": text, "content": tiptap doc, "text": text }]
-- Returns { chapter_id, scene_ids }.
-- ---------------------------------------------------------------------------
create or replace function public.insert_drafted_scenes(
  p_book_id uuid,
  p_scenes jsonb,
  p_after_scene_id uuid default null,
  p_after_chapter_id uuid default null,
  p_chapter_title text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_chapter uuid;
  v_pos integer;
  v_sc jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if not exists (select 1 from public.books where id = p_book_id) then
    raise exception 'BOOK_NOT_FOUND' using errcode = 'PT404';
  end if;
  if jsonb_typeof(p_scenes) <> 'array' or jsonb_array_length(p_scenes) = 0 or jsonb_array_length(p_scenes) > 100 then
    raise exception 'INVALID_SCENES' using errcode = '22023';
  end if;
  for v_sc in select * from jsonb_array_elements(p_scenes) loop
    if v_sc -> 'content' ->> 'type' is distinct from 'doc' then
      raise exception 'INVALID_CONTENT' using errcode = '22023';
    end if;
  end loop;

  if p_after_scene_id is not null then
    select chapter_id, position + 1 into v_chapter, v_pos from public.scenes where id = p_after_scene_id and book_id = p_book_id;
    if v_chapter is null then
      raise exception 'SCENE_NOT_FOUND' using errcode = 'PT404';
    end if;
    update public.scenes set position = position + jsonb_array_length(p_scenes) where chapter_id = v_chapter and position >= v_pos;
  else
    if p_after_chapter_id is not null then
      select position + 1 into v_pos from public.chapters where id = p_after_chapter_id and book_id = p_book_id;
    end if;
    if v_pos is null then
      select coalesce(max(position), -1) + 1 into v_pos from public.chapters where book_id = p_book_id;
    else
      update public.chapters set position = position + 1 where book_id = p_book_id and position >= v_pos;
    end if;
    insert into public.chapters (book_id, title, position)
      values (p_book_id, coalesce(nullif(btrim(p_chapter_title), ''), 'New chapter'), v_pos)
      returning id into v_chapter;
    v_pos := 0;
  end if;

  for v_sc in select * from jsonb_array_elements(p_scenes) loop
    insert into public.scenes (book_id, chapter_id, title, position, content, content_text, word_count, last_edited_at)
      values (p_book_id, v_chapter, left(coalesce(nullif(btrim(v_sc ->> 'title'), ''), 'Scene'), 200), v_pos,
        v_sc -> 'content', coalesce(v_sc ->> 'text', ''), public.count_words(v_sc ->> 'text'), now())
      returning id into v_id;
    v_ids := v_ids || v_id;
    v_pos := v_pos + 1;
  end loop;

  -- A new chapter starts with exactly the drafted scenes.
  return jsonb_build_object('chapter_id', v_chapter, 'scene_ids', to_jsonb(v_ids));
end $$;
revoke all on function public.insert_drafted_scenes(uuid, jsonb, uuid, uuid, text) from public, anon;
grant execute on function public.insert_drafted_scenes(uuid, jsonb, uuid, uuid, text) to authenticated;
