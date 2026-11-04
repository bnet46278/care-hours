-- Care Hours database setup for Supabase.
-- Run this once: Supabase dashboard -> SQL Editor -> New query -> paste all of this -> Run.
-- It is safe to run again; it won't duplicate anything.
--
-- Who can see what:
--   * A caregiver (the "owner") can read and change only their own shifts.
--   * A caregiver can share their hours with people by email (for example, whoever pays them).
--   * Those people can read the caregiver's shifts but can never change them.
--   * Everyone else sees nothing.

-- ---------- Tables ----------

-- One row per shift. "id" is created by the app, so a shift recorded offline keeps the same id.
create table if not exists public.shifts (
  owner       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null check (char_length(id) between 1 and 64),
  start_at    timestamptz not null,
  end_at      timestamptz,
  person      text        not null default '' check (char_length(person) <= 200),
  note        text        not null default '' check (char_length(note) <= 4000),
  deleted     boolean     not null default false,   -- deleted shifts are kept as markers so every device learns about the delete
  updated_at  timestamptz not null default now(),
  primary key (owner, id),
  check (end_at is null or end_at >= start_at)
);

-- Who each caregiver shares their hours with.
create table if not exists public.shares (
  owner         uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  viewer_email  text        not null check (viewer_email = lower(viewer_email) and viewer_email like '%_@_%'),
  created_at    timestamptz not null default now(),
  primary key (owner, viewer_email)
);

-- The caregiver's display name, shown to the people they share with.
create table if not exists public.profiles (
  id            uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name  text not null default '' check (char_length(display_name) <= 100),
  email         text not null default '',
  updated_at    timestamptz not null default now()
);

create index if not exists shares_viewer_email_idx on public.shares (viewer_email);

-- ---------- Helper ----------

-- The signed-in person's email, lowercased. Supabase only issues a session after the
-- person proves they own the address (by entering the emailed code), so this is trustworthy.
create or replace function public.my_email() returns text
language sql stable
as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- True when "the_owner" has shared their hours with the signed-in person.
-- security definer lets the check read the shares table without opening it up to everyone.
create or replace function public.is_shared_with_me(the_owner uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.shares s
    where s.owner = the_owner and s.viewer_email = public.my_email() and public.my_email() <> ''
  )
$$;

-- ---------- Access rules (row level security) ----------

alter table public.shifts   enable row level security;
alter table public.shares   enable row level security;
alter table public.profiles enable row level security;

-- Shifts: owners do everything with their own rows.
drop policy if exists "owner manages own shifts" on public.shifts;
create policy "owner manages own shifts" on public.shifts
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- Shifts: people the owner shared with can read (never write).
drop policy if exists "shared viewers read shifts" on public.shifts;
create policy "shared viewers read shifts" on public.shifts
  for select to authenticated
  using (public.is_shared_with_me(owner));

-- Shares: owners manage their own share list.
drop policy if exists "owner manages own shares" on public.shares;
create policy "owner manages own shares" on public.shares
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- Shares: a viewer can see the shares that name them, so the app knows whose hours to show.
drop policy if exists "viewer sees shares naming them" on public.shares;
create policy "viewer sees shares naming them" on public.shares
  for select to authenticated
  using (viewer_email = public.my_email() and public.my_email() <> '');

-- Profiles: owners manage their own profile.
drop policy if exists "owner manages own profile" on public.profiles;
create policy "owner manages own profile" on public.profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Profiles: viewers can read the profile of anyone who shared with them.
drop policy if exists "shared viewers read profile" on public.profiles;
create policy "shared viewers read profile" on public.profiles
  for select to authenticated
  using (public.is_shared_with_me(id));

-- Nobody who is signed out can touch any of this.
revoke all on public.shifts, public.shares, public.profiles from anon;
grant select, insert, update, delete on public.shifts, public.shares, public.profiles to authenticated;
grant execute on function public.my_email(), public.is_shared_with_me(uuid) to authenticated;
revoke execute on function public.is_shared_with_me(uuid) from anon, public;
