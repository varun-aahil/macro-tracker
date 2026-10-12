-- run this once in Supabase: SQL Editor -> New query -> paste -> Run
-- one table holds everything a person syncs. every row belongs to one user, and the rules below
-- make sure nobody can read or change anyone else's rows.

create table if not exists public.sync_items (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('food', 'meal', 'setting')),
  key        text not null,
  data       jsonb,
  mod        timestamptz not null,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, key)
);

create index if not exists sync_items_user_updated on public.sync_items (user_id, updated_at);

alter table public.sync_items enable row level security;

drop policy if exists "read own rows" on public.sync_items;
drop policy if exists "add own rows" on public.sync_items;
drop policy if exists "change own rows" on public.sync_items;
drop policy if exists "delete own rows" on public.sync_items;

create policy "read own rows"   on public.sync_items for select using (auth.uid() = user_id);
create policy "add own rows"    on public.sync_items for insert with check (auth.uid() = user_id);
create policy "change own rows" on public.sync_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own rows" on public.sync_items for delete using (auth.uid() = user_id);

-- the server stamps updated_at, so devices with wrong clocks can't confuse "what's new since I last synced"
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists sync_items_touch on public.sync_items;
create trigger sync_items_touch before insert or update on public.sync_items
  for each row execute function public.touch_updated_at();
