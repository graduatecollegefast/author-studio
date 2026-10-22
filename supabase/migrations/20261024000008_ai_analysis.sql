-- Phase 2B: AI book analysis, discoveries with evidence, review and approval.

-- ---------------------------------------------------------------------------
-- Per-author AI settings: spending limits and model routing.
-- API keys are never stored here; they live only in server environment variables.
-- ---------------------------------------------------------------------------
create table public.ai_settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  daily_limit_usd numeric(10, 2) not null default 2.00 check (daily_limit_usd >= 0 and daily_limit_usd <= 1000),
  monthly_limit_usd numeric(10, 2) not null default 20.00 check (monthly_limit_usd >= 0 and monthly_limit_usd <= 10000),
  max_task_usd numeric(10, 2) not null default 1.00 check (max_task_usd >= 0 and max_task_usd <= 1000),
  -- { "<task type>": { "provider": "anthropic" | "openai", "model": "<model id>" } }
  routing jsonb not null default '{}'::jsonb check (jsonb_typeof(routing) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.ai_settings enable row level security;
create policy "owner full access" on public.ai_settings for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.ai_settings from anon;
grant select, insert, update on public.ai_settings to authenticated;
create trigger set_updated_at before update on public.ai_settings for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Chunk analysis progress (resumable: each chunk is analyzed once).
-- ---------------------------------------------------------------------------
alter table public.document_chunks
  add column summary text,
  add column analysis_error text,
  drop constraint document_chunks_analysis_status_check,
  add constraint document_chunks_analysis_status_check
    check (analysis_status in ('pending', 'processing', 'completed', 'failed', 'declined'));

-- ---------------------------------------------------------------------------
-- Discoveries are canon_facts with status 'proposed' until the author reviews them.
-- ---------------------------------------------------------------------------
alter table public.canon_facts
  add column category text check (category is null or category in (
    'character', 'relationship', 'world', 'timeline', 'plot', 'theme', 'style', 'series')),
  add column payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  add column ai_task_id uuid,
  add column manuscript_file_id uuid,
  add foreign key (ai_task_id, owner_id) references public.ai_tasks (id, owner_id) on delete set null (ai_task_id),
  add foreign key (manuscript_file_id, owner_id) references public.manuscript_files (id, owner_id) on delete set null (manuscript_file_id);
create index canon_facts_book_review_idx on public.canon_facts (book_id, status, category);

-- Save one chunk's discoveries and mark it analyzed, atomically.
-- Identical proposals (same book, subject, attribute, value) gain another source instead of a duplicate.
-- p_facts: [{ category, entity_type, entity_label, attribute, value, statement_type, confidence,
--             excerpt, char_start, char_end, payload }]
create or replace function public.save_chunk_discoveries(p_chunk_id uuid, p_task_id uuid, p_summary text, p_facts jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_chunk public.document_chunks%rowtype;
  v_f jsonb;
  v_fact uuid;
  v_count integer := 0;
begin
  select * into v_chunk from public.document_chunks where id = p_chunk_id;
  if v_chunk.id is null then
    raise exception 'CHUNK_NOT_FOUND' using errcode = 'PT404';
  end if;
  if jsonb_typeof(p_facts) <> 'array' or jsonb_array_length(p_facts) > 200 then
    raise exception 'INVALID_FACTS' using errcode = '22023';
  end if;

  for v_f in select * from jsonb_array_elements(p_facts) loop
    select id into v_fact from public.canon_facts
      where book_id = v_chunk.book_id
        and entity_type = v_f ->> 'entity_type'
        and lower(coalesce(entity_label, '')) = lower(coalesce(v_f ->> 'entity_label', ''))
        and lower(attribute) = lower(v_f ->> 'attribute')
        and lower(value) = lower(v_f ->> 'value')
        and status in ('proposed', 'approved', 'provisional')
      limit 1;
    if v_fact is null then
      insert into public.canon_facts (book_id, entity_type, entity_label, attribute, value, statement_type, status,
        confidence, category, payload, ai_task_id, manuscript_file_id)
      values (v_chunk.book_id, v_f ->> 'entity_type', left(v_f ->> 'entity_label', 200), left(v_f ->> 'attribute', 100),
        left(v_f ->> 'value', 2000), v_f ->> 'statement_type', 'proposed',
        least(1, greatest(0, coalesce((v_f ->> 'confidence')::numeric, 0.5)))::numeric(3, 2),
        v_f ->> 'category', coalesce(v_f -> 'payload', '{}'::jsonb), p_task_id, v_chunk.manuscript_file_id)
      returning id into v_fact;
      v_count := v_count + 1;
    end if;
    insert into public.fact_sources (fact_id, manuscript_file_id, book_id, chunk_id, location_label, excerpt, char_start, char_end)
    values (v_fact, v_chunk.manuscript_file_id, v_chunk.book_id, v_chunk.id, v_chunk.chapter_label,
      left(v_f ->> 'excerpt', 1000), (v_f ->> 'char_start')::integer, (v_f ->> 'char_end')::integer);
  end loop;

  update public.document_chunks
    set analysis_status = 'completed', summary = left(p_summary, 4000), analysis_error = null, processed_at = now()
    where id = p_chunk_id;
  return v_count;
end $$;

-- Find a character by name, preferred name, nickname or alias; create one if none matches.
create or replace function public.find_or_create_character(p_name text, p_book uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_name text := btrim(p_name);
begin
  if v_name is null or v_name = '' then return null; end if;
  select id into v_id from public.characters c
    where lower(c.full_name) = lower(v_name)
       or lower(coalesce(c.preferred_name, '')) = lower(v_name)
       or exists (select 1 from unnest(c.aliases || c.nicknames) a where lower(a) = lower(v_name))
    order by (lower(c.full_name) = lower(v_name)) desc, c.created_at
    limit 1;
  -- A first name alone ("Mara") matches the one character whose full name starts with it ("Mara Vance").
  if v_id is null and position(' ' in v_name) = 0 then
    select min(id::text)::uuid into v_id from public.characters c
      where lower(split_part(c.full_name, ' ', 1)) = lower(v_name)
      having count(*) = 1;
  end if;
  -- A fuller name ("Mara Vance") upgrades the one character known only by its first part ("Mara").
  if v_id is null and position(' ' in v_name) > 0 then
    select min(id::text)::uuid into v_id from public.characters c
      where lower(c.full_name) = lower(split_part(v_name, ' ', 1))
      having count(*) = 1;
    if v_id is not null then
      update public.characters
        set nicknames = case when full_name = any(nicknames) then nicknames else nicknames || full_name end,
            full_name = left(v_name, 200)
        where id = v_id;
    end if;
  end if;
  if v_id is null then
    insert into public.characters (full_name, first_appearance_book_id) values (left(v_name, 200), p_book) returning id into v_id;
  end if;
  if p_book is not null and not exists (
    select 1 from public.character_appearances where character_id = v_id and book_id = p_book and chapter_id is null and scene_id is null
  ) then
    insert into public.character_appearances (character_id, book_id) values (v_id, p_book);
  end if;
  return v_id;
end $$;

-- Approve or reject discoveries. Approval files each fact into the Story Bible:
-- characters (with a dated state per book, never overwriting history), relationships,
-- world elements, timeline events, and book themes. Rejection only changes status.
create or replace function public.review_discoveries(p_fact_ids uuid[], p_action text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  f public.canon_facts%rowtype;
  v_entity uuid;
  v_other uuid;
  v_col text;
  v_key text;
  v_section text;
  v_rel uuid;
  v_rel_cat text;
  v_wcat text;
  v_done integer := 0;
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'INVALID_ACTION' using errcode = '22023';
  end if;
  if coalesce(array_length(p_fact_ids, 1), 0) > 1000 then
    raise exception 'TOO_MANY' using errcode = '22023';
  end if;

  for f in select * from public.canon_facts where id = any(p_fact_ids) and status = 'proposed' order by created_at loop
    if p_action = 'reject' then
      update public.canon_facts set status = 'rejected' where id = f.id;
      v_done := v_done + 1;
      continue;
    end if;

    v_entity := null;
    if f.entity_type = 'character' then
      v_entity := public.find_or_create_character(f.entity_label, f.book_id);
      if f.attribute in ('alias', 'nickname') then
        update public.characters
          set aliases = case when f.attribute = 'alias' and not (f.value = any(aliases)) then aliases || f.value else aliases end,
              nicknames = case when f.attribute = 'nickname' and not (f.value = any(nicknames)) then nicknames || f.value else nicknames end
          where id = v_entity and lower(full_name) <> lower(f.value);
      else
        -- Simple profile fields are filled only when empty; the dated state keeps every version.
        v_col := f.attribute;
        if v_col in ('pronouns', 'gender_identity', 'date_of_birth', 'age', 'occupation', 'education', 'role', 'preferred_name') then
          execute format('update public.characters set %I = $1 where id = $2 and (%I is null or btrim(%I) = %L)', v_col, v_col, v_col, '')
            using left(f.value, 500), v_entity;
        elsif v_col ~ '^(appearance|personality|history)\.[a-z_]+$' then
          v_section := split_part(v_col, '.', 1);
          v_key := split_part(v_col, '.', 2);
          execute format(
            'update public.characters set %I = jsonb_set(%I, array[$1], to_jsonb(
               case when %I ? $1 and btrim(%I ->> $1) <> %L then (%I ->> $1) || %L || $2 else $2 end)) where id = $3',
            v_section, v_section, v_section, v_section, '', v_section, '; ')
            using v_key, left(f.value, 1000), v_entity;
        end if;
        insert into public.character_states (character_id, book_id, attribute, value, period_label, notes)
          values (v_entity, f.book_id, left(f.attribute, 100), left(f.value, 2000), f.valid_period_label,
            case when f.statement_type <> 'author_confirmed' and f.statement_type <> 'narrator'
              then 'Source: ' || replace(f.statement_type, '_', ' ') end);
      end if;

    elsif f.entity_type = 'relationship' then
      v_entity := public.find_or_create_character(f.entity_label, f.book_id);
      v_other := public.find_or_create_character(f.payload ->> 'related_name', f.book_id);
      v_rel_cat := coalesce(nullif(f.payload ->> 'relationship_category', ''), 'custom');
      if v_rel_cat not in ('romantic', 'sexual', 'married', 'former_partner', 'family', 'friendship', 'professional',
          'rivalry', 'conflict', 'mentorship', 'custom') then
        v_rel_cat := 'custom';
      end if;
      if v_other is not null and v_other <> v_entity then
        select id into v_rel from public.relationships
          where category = v_rel_cat
            and ((character_a_id = v_entity and character_b_id = v_other) or (character_a_id = v_other and character_b_id = v_entity))
          limit 1;
        if v_rel is null then
          insert into public.relationships (character_a_id, character_b_id, category, custom_label, description, current_status, start_book_id)
            values (v_entity, v_other, v_rel_cat, nullif(left(replace(f.attribute, '_', ' '), 100), replace(v_rel_cat, '_', ' ')),
              left(f.value, 2000), nullif(f.payload ->> 'status', ''), f.book_id)
            returning id into v_entity;
        else
          v_entity := v_rel;
          update public.relationships
            set description = case when description is null or btrim(description) = '' then left(f.value, 2000)
                                   else left(description || E'\n' || f.value, 4000) end
            where id = v_entity;
        end if;
      end if;

    elsif f.entity_type = 'world_element' then
      v_wcat := lower(coalesce(nullif(f.payload ->> 'world_category', ''), 'other'));
      select id into v_entity from public.world_elements
        where universe_id is null and lower(name) = lower(f.entity_label) and category = v_wcat;
      if v_entity is null then
        insert into public.world_elements (name, category, description)
          values (left(f.entity_label, 200), v_wcat, case when f.attribute = 'description' then left(f.value, 4000) end)
          returning id into v_entity;
      elsif f.attribute = 'description' then
        update public.world_elements set description = left(f.value, 4000)
          where id = v_entity and (description is null or btrim(description) = '');
      end if;
      if f.attribute = 'rule' then
        update public.world_elements
          set rules = case when rules is null or btrim(rules) = '' then left(f.value, 4000) else left(rules || E'\n' || f.value, 8000) end
          where id = v_entity;
      elsif f.attribute = 'history' then
        update public.world_elements
          set history = case when history is null or btrim(history) = '' then left(f.value, 4000) else left(history || E'\n' || f.value, 8000) end
          where id = v_entity;
      end if;
      if f.book_id is not null and not exists (select 1 from public.world_element_links where world_element_id = v_entity and book_id = f.book_id) then
        insert into public.world_element_links (world_element_id, book_id) values (v_entity, f.book_id);
      end if;

    elsif f.entity_type = 'story_event' then
      insert into public.story_events (book_id, title, description, approximate_label, date_precision, is_flashback, reliability)
        values (f.book_id, left(coalesce(f.entity_label, f.value), 300), left(f.value, 4000), nullif(f.payload ->> 'when', ''),
          case when coalesce(f.payload ->> 'when', '') = '' then 'unknown' else 'relative' end,
          coalesce((f.payload ->> 'is_flashback')::boolean, false) or f.statement_type = 'flashback',
          case when f.statement_type in ('rumor', 'dream', 'character_belief', 'character_statement') then 'uncertain' else 'confirmed' end)
        returning id into v_entity;
      insert into public.story_event_characters (event_id, character_id)
        select v_entity, c.id from public.characters c
        where lower(c.full_name) in (select lower(x) from jsonb_array_elements_text(coalesce(f.payload -> 'characters', '[]'::jsonb)) x)
        on conflict do nothing;

    elsif f.entity_type = 'book' and f.category = 'theme' and f.attribute = 'theme' and f.book_id is not null then
      update public.books set themes = themes || left(f.value, 200)
        where id = f.book_id and not exists (select 1 from unnest(themes) t where lower(t) = lower(f.value));
    end if;

    update public.canon_facts
      set status = 'approved', approved_at = now(), entity_id = coalesce(v_entity, entity_id)
      where id = f.id;
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object('updated', v_done);
end $$;

revoke all on function public.save_chunk_discoveries(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.find_or_create_character(text, uuid) from public, anon;
revoke all on function public.review_discoveries(uuid[], text) from public, anon;
grant execute on function public.save_chunk_discoveries(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.find_or_create_character(text, uuid) to authenticated;
grant execute on function public.review_discoveries(uuid[], text) to authenticated;
