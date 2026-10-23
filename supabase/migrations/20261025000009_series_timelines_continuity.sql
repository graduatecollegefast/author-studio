-- Phase 3: series and universes, relationship mapper, story timelines, continuity checker.

-- ---------------------------------------------------------------------------
-- Series-wide plot threads, story arcs, unresolved mysteries and future book ideas.
-- ---------------------------------------------------------------------------
alter table public.plot_threads
  add column kind text not null default 'thread' check (kind in ('thread', 'arc', 'mystery', 'future_idea')),
  add column position integer not null default 0;
create index plot_threads_series_idx on public.plot_threads (series_id, kind, position);
create index plot_threads_universe_idx on public.plot_threads (universe_id, kind, position);

-- ---------------------------------------------------------------------------
-- Relationships: past status, important changes, relevant books and events.
-- ---------------------------------------------------------------------------
alter table public.relationships
  add column past_status text,
  add column important_changes text,
  add constraint relationships_id_owner_key unique (id, owner_id);

create table public.relationship_books (
  relationship_id uuid not null,
  book_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (relationship_id, book_id),
  foreign key (relationship_id, owner_id) references public.relationships (id, owner_id) on delete cascade,
  foreign key (book_id, owner_id) references public.books (id, owner_id) on delete cascade
);
create index relationship_books_book_idx on public.relationship_books (book_id);

create table public.relationship_events (
  relationship_id uuid not null,
  event_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (relationship_id, event_id),
  foreign key (relationship_id, owner_id) references public.relationships (id, owner_id) on delete cascade,
  foreign key (event_id, owner_id) references public.story_events (id, owner_id) on delete cascade
);
create index relationship_events_event_idx on public.relationship_events (event_id);

-- Every pair relationship involves its two characters; a group relationship involves the group.
create index relationships_group_idx on public.relationships (group_id);
create index relationship_group_members_character_idx on public.relationship_group_members (character_id);

-- ---------------------------------------------------------------------------
-- Timeline events: an approximate end period and author notes.
-- ---------------------------------------------------------------------------
alter table public.story_events
  add column end_label text,
  add column notes text,
  add constraint story_events_dates_ordered check (date_end is null or date_start is null or date_end >= date_start);
create index story_events_universe_idx on public.story_events (universe_id, chronological_order);
create index story_events_series_idx on public.story_events (series_id, chronological_order);
create index story_event_characters_character_idx on public.story_event_characters (character_id);

-- ---------------------------------------------------------------------------
-- Continuity findings keep where each side of the conflict came from.
-- ---------------------------------------------------------------------------
alter table public.editorial_findings
  add column canon_fact_ids uuid[] not null default '{}',
  add column original_location text,
  add column conflicting_location text,
  add column author_note text,
  add column reviewed_at timestamptz;
create index editorial_findings_book_idx on public.editorial_findings (book_id, review_type, status);

-- ---------------------------------------------------------------------------
-- Privileges, row-level security and ownership guards for the new tables.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['relationship_books', 'relationship_events']
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

-- Book order inside a series: one call sets reading, chronological and publication order.
-- p_rows: [{ "book_id": uuid, "reading_order": int, "chronological_order": int, "publication_order": int }]
create or replace function public.set_series_order(p_series_id uuid, p_rows jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_row jsonb;
  v_n integer := 0;
begin
  if not exists (select 1 from public.series where id = p_series_id) then
    raise exception 'SERIES_NOT_FOUND' using errcode = 'PT404';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'INVALID_ORDER' using errcode = '22023';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    update public.series_books
      set reading_order = (v_row ->> 'reading_order')::integer,
          chronological_order = (v_row ->> 'chronological_order')::integer,
          publication_order = (v_row ->> 'publication_order')::integer
      where series_id = p_series_id and book_id = (v_row ->> 'book_id')::uuid;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.set_series_order(uuid, jsonb) from public, anon;
grant execute on function public.set_series_order(uuid, jsonb) to authenticated;
