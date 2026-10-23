-- Where a character lives, and when the story happens.
-- characters.residence: where the character lives (filled by the author or from approved discoveries).
-- books.story_start_date: the in-story date the book begins, set by the author.
-- chapters.story_date: the in-story date of a chapter, detected from the text or set by the author,
-- with the words it was read from. Used to work out every character's age at that point.

alter table public.characters add column residence text;
alter table public.books add column story_start_date date;
alter table public.chapters
  add column story_date date,
  add column story_date_text text,
  add column story_date_source text check (story_date_source is null or story_date_source in ('detected', 'author'));

-- Approved discoveries can now fill in where a character lives.
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
        if v_col in ('pronouns', 'gender_identity', 'date_of_birth', 'age', 'occupation', 'education', 'role', 'preferred_name', 'residence') then
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

-- Merging keeps a residence the same way as every other detail.
create or replace function public.merge_characters(p_keep uuid, p_merge uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  k public.characters%rowtype;
  m public.characters%rowtype;
  v_ids uuid[];
  v_moved integer := 0;
  v_n integer;
  v_names text[];
begin
  if p_merge is null or cardinality(p_merge) = 0 or cardinality(p_merge) > 20 then
    raise exception 'INVALID_MERGE' using errcode = '22023';
  end if;
  v_ids := array(select distinct x from unnest(p_merge) x where x is not null and x <> p_keep);
  if cardinality(v_ids) = 0 then
    raise exception 'INVALID_MERGE' using errcode = '22023';
  end if;
  select * into k from public.characters where id = p_keep for update;
  if not found then
    raise exception 'CHARACTER_NOT_FOUND' using errcode = 'PT404';
  end if;
  if (select count(*) from public.characters where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'CHARACTER_NOT_FOUND' using errcode = 'PT404';
  end if;

  for m in select * from public.characters where id = any (v_ids) order by created_at for update loop
    -- History first: a full copy of the record being merged away.
    insert into public.activity_log (action, entity_type, entity_id, metadata)
    values ('character.merged', 'character', p_keep, jsonb_build_object('merged', to_jsonb(m) - 'search' - 'owner_id'));

    -- Profile: the kept record wins; blanks are filled from the merged one.
    v_names := array(
      select distinct n from unnest(
        coalesce(k.aliases, '{}') || coalesce(m.aliases, '{}')
        || array[m.full_name, m.preferred_name]
      ) n
      where n is not null and btrim(n) <> '' and lower(btrim(n)) <> lower(btrim(k.full_name))
        and lower(btrim(n)) <> lower(btrim(coalesce(k.preferred_name, '')))
    );
    update public.characters c set
      preferred_name = coalesce(nullif(btrim(k.preferred_name), ''), m.preferred_name),
      aliases = v_names,
      nicknames = array(select distinct n from unnest(coalesce(k.nicknames, '{}') || coalesce(m.nicknames, '{}')) n where n is not null and btrim(n) <> ''),
      pronouns = coalesce(nullif(btrim(k.pronouns), ''), m.pronouns),
      gender_identity = coalesce(nullif(btrim(k.gender_identity), ''), m.gender_identity),
      sexual_orientation = coalesce(nullif(btrim(k.sexual_orientation), ''), m.sexual_orientation),
      romantic_orientation = coalesce(nullif(btrim(k.romantic_orientation), ''), m.romantic_orientation),
      date_of_birth = coalesce(nullif(btrim(k.date_of_birth), ''), m.date_of_birth),
      age = coalesce(nullif(btrim(k.age), ''), m.age),
      occupation = coalesce(nullif(btrim(k.occupation), ''), m.occupation),
      residence = coalesce(nullif(btrim(k.residence), ''), m.residence),
      education = coalesce(nullif(btrim(k.education), ''), m.education),
      role = coalesce(nullif(btrim(k.role), ''), m.role),
      appearance = coalesce(m.appearance, '{}'::jsonb) || coalesce(k.appearance, '{}'::jsonb),
      personality = coalesce(m.personality, '{}'::jsonb) || coalesce(k.personality, '{}'::jsonb),
      history = coalesce(m.history, '{}'::jsonb) || coalesce(k.history, '{}'::jsonb),
      custom_fields = coalesce(m.custom_fields, '{}'::jsonb) || coalesce(k.custom_fields, '{}'::jsonb),
      notes = case
        when coalesce(btrim(m.notes), '') = '' then k.notes
        when coalesce(btrim(k.notes), '') = '' then m.notes
        else k.notes || E'\n\n' || 'From the merged record "' || m.full_name || '":' || E'\n' || m.notes
      end,
      first_appearance_book_id = coalesce(k.first_appearance_book_id, m.first_appearance_book_id),
      universe_id = coalesce(k.universe_id, m.universe_id)
    where c.id = p_keep
    returning * into k;

    -- Links that cannot hold the same pair twice: drop the copy, move the rest.
    delete from public.relationship_group_members g where g.character_id = m.id
      and exists (select 1 from public.relationship_group_members x where x.group_id = g.group_id and x.character_id = p_keep);
    update public.relationship_group_members set character_id = p_keep where character_id = m.id;
    delete from public.story_event_characters s where s.character_id = m.id
      and exists (select 1 from public.story_event_characters x where x.event_id = s.event_id and x.character_id = p_keep);
    update public.story_event_characters set character_id = p_keep where character_id = m.id;
    delete from public.idea_characters i where i.character_id = m.id
      and exists (select 1 from public.idea_characters x where x.idea_id = i.idea_id and x.character_id = p_keep);
    update public.idea_characters set character_id = p_keep where character_id = m.id;
    delete from public.character_appearances a where a.character_id = m.id
      and exists (select 1 from public.character_appearances x where x.character_id = p_keep and x.book_id = a.book_id
        and x.chapter_id is not distinct from a.chapter_id and x.scene_id is not distinct from a.scene_id);
    update public.character_appearances set character_id = p_keep where character_id = m.id;
    get diagnostics v_n = row_count;
    v_moved := v_moved + v_n;

    -- A relationship between the two records was between one person and themself.
    delete from public.relationships r
      where (r.character_a_id = m.id and r.character_b_id = p_keep) or (r.character_a_id = p_keep and r.character_b_id = m.id);
    update public.relationships set character_a_id = p_keep where character_a_id = m.id;
    update public.relationships set character_b_id = p_keep where character_b_id = m.id;

    update public.character_states set character_id = p_keep where character_id = m.id;
    update public.world_element_links set character_id = p_keep where character_id = m.id;
    update public.scenes set pov_character_id = p_keep where pov_character_id = m.id;

    -- Canon facts and discoveries about the merged record, and ids inside their details.
    update public.canon_facts set entity_id = p_keep, entity_label = coalesce(entity_label, k.full_name)
      where entity_type = 'character' and entity_id = m.id;
    update public.canon_facts set payload = replace(payload::text, m.id::text, p_keep::text)::jsonb
      where payload::text like '%' || m.id::text || '%';
    update public.ideas set converted_entity_id = p_keep where converted_entity_type = 'character' and converted_entity_id = m.id;

    delete from public.characters where id = m.id;
  end loop;

  return jsonb_build_object('kept', p_keep, 'merged', to_jsonb(v_ids), 'appearances_moved', v_moved);
end $$;
