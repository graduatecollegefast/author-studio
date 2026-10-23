-- Merge duplicate characters into one record. Runs as the calling author (row-level
-- security applies), in one transaction: either everything moves or nothing changes.
-- The kept record keeps its own details and takes any detail it is missing from the
-- others; their names become aliases. Everything that pointed at the others (book
-- appearances, history, relationships, groups, timeline events, world links, ideas, POV,
-- canon facts and discoveries) now points at the kept record. A full copy of each merged
-- record is saved in the activity log before it is removed.

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

revoke all on function public.merge_characters(uuid, uuid[]) from public, anon;
grant execute on function public.merge_characters(uuid, uuid[]) to authenticated;
