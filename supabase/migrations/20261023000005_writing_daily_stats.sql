-- Daily writing totals for word-count goals.
-- Counted when an author edits a scene (word_count changes on UPDATE), bucketed
-- by the author's own time zone from profiles.preferences.timezone. Imports
-- insert scenes directly and therefore never inflate "words written today".

create table public.writing_daily_stats (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  words_added integer not null default 0 check (words_added >= 0),
  words_removed integer not null default 0 check (words_removed >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, day)
);

alter table public.writing_daily_stats enable row level security;
create policy "owner can read" on public.writing_daily_stats
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner can insert" on public.writing_daily_stats
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "owner can update" on public.writing_daily_stats
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.writing_daily_stats from anon;
grant select, insert, update on public.writing_daily_stats to authenticated;

create or replace function public.author_today(p_owner uuid)
returns date language plpgsql stable set search_path = '' as $$
declare v_tz text;
begin
  select p.preferences ->> 'timezone' into v_tz from public.profiles p where p.id = p_owner;
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;
  return (now() at time zone v_tz)::date;
end $$;

create or replace function public.track_daily_words()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_delta integer := new.word_count - old.word_count;
begin
  if v_delta = 0 then
    return null;
  end if;
  insert into public.writing_daily_stats as d (owner_id, day, words_added, words_removed)
  values (new.owner_id, public.author_today(new.owner_id), greatest(v_delta, 0), greatest(-v_delta, 0))
  on conflict (owner_id, day) do update
    set words_added = d.words_added + excluded.words_added,
        words_removed = d.words_removed + excluded.words_removed,
        updated_at = now();
  return null;
end $$;

create trigger scenes_track_daily_words
  after update of word_count on public.scenes
  for each row execute function public.track_daily_words();

revoke all on function public.author_today(uuid) from public, anon;
grant execute on function public.author_today(uuid) to authenticated;
