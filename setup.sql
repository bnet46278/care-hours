-- Care Hours database setup for Supabase.
-- Run this once: Supabase dashboard -> SQL Editor -> New query -> paste all of this -> Run.
-- It is safe to run again; it won't duplicate anything.
--
-- Who can see what:
--   * A caregiver (the "owner") can read and change only their own shifts.
--   * A caregiver shares one patient at a time with someone by email (for example, whoever pays
--     for that patient's care).
--   * That person can read only the shifts whose "Caring for" name matches that patient, and can
--     never change them. Shifts with no patient name are never shared.
--   * Everyone else sees nothing.
--
-- Version 4 adds messages between caregivers and payers, and a phone number for the Text button.
--   * Two people can message each other only when one of them shares a patient with the other.
--   * Only the sender and the recipient can read a message. Nobody can edit or delete one, and
--     only the recipient can mark it read.
--   * A phone number is seen only by the people you share with (or who share with you).
-- If you ran version 3, run this whole file again. Nothing you already have is changed.
--
-- Version 3 adds the schedule (repeating shifts, one-time shifts and time off).
-- Payers see scheduled shifts for their patient, and see a caregiver's time off only as "unavailable".
--
-- Version 2 (per-patient sharing). If you ran the first version, run this whole file again.
-- Shares made with the first version covered all of a caregiver's hours, so they are removed;
-- share again, picking the patient.

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

-- Which patient's hours each caregiver shares, and with whom.
create table if not exists public.shares (
  owner         uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  viewer_email  text        not null check (viewer_email = lower(viewer_email) and viewer_email like '%_@_%'),
  person        text        not null default '',
  created_at    timestamptz not null default now()
);

-- Upgrade from version 1, where a share covered all of a caregiver's hours.
alter table public.shares add column if not exists person text not null default '';
delete from public.shares where btrim(person) = '';
alter table public.shares drop constraint if exists shares_pkey;
alter table public.shares add constraint shares_pkey primary key (owner, viewer_email, person);
alter table public.shares drop constraint if exists shares_person_check;
alter table public.shares add constraint shares_person_check check (char_length(btrim(person)) between 1 and 200);

-- The caregiver's display name, shown to the people they share with.
create table if not exists public.profiles (
  id            uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name  text not null default '' check (char_length(display_name) <= 100),
  email         text not null default '',
  updated_at    timestamptz not null default now()
);

-- Version 4: a mobile number, so the people you share with can text you from the app.
alter table public.profiles add column if not exists phone text not null default '' check (char_length(phone) <= 30);

create index if not exists shares_viewer_email_idx on public.shares (viewer_email);

-- The schedule: what a caregiver plans to work, and when they can't.
--   weekly: repeats on the given weekdays (0 = Sunday ... 6 = Saturday) from on_date, until until_date if set
--   once:   one shift on on_date
--   off:    time off from on_date (at start_time, or all day) to until_date (at end_time, or end of day)
-- Times are local wall-clock times. A shift whose end_time is earlier than its start_time ends the next day.
create table if not exists public.schedule (
  owner       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null check (char_length(id) between 1 and 64),
  kind        text        not null check (kind in ('weekly', 'once', 'off')),
  person      text        not null default '' check (char_length(person) <= 200),
  days        smallint[]  not null default '{}',
  on_date     date        not null,
  until_date  date,
  start_time  time,
  end_time    time,
  note        text        not null default '' check (char_length(note) <= 2000),
  deleted     boolean     not null default false,
  updated_at  timestamptz not null default now(),
  primary key (owner, id),
  -- Shifts need a patient and times; time off has no patient and no note (payers see it as "unavailable").
  check (deleted or (kind = 'off' and person = '' and note = '')
                 or (kind <> 'off' and char_length(btrim(person)) > 0 and start_time is not null and end_time is not null)),
  check (deleted or kind <> 'weekly' or (cardinality(days) between 1 and 7 and days <@ array[0,1,2,3,4,5,6]::smallint[])),
  check (until_date is null or until_date >= on_date)
);

-- Messages between a caregiver and a payer. The sender and the time are filled in by the database.
create table if not exists public.messages (
  id          uuid        primary key default gen_random_uuid(),
  sender      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  recipient   uuid        not null references auth.users (id) on delete cascade,
  body        text        not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists messages_recipient_idx on public.messages (recipient, created_at);
create index if not exists messages_sender_idx on public.messages (sender, created_at);

-- ---------- Helper ----------

-- The signed-in person's email, lowercased. Supabase only issues a session after the
-- person proves they own the address (by entering the emailed code), so this is trustworthy.
create or replace function public.my_email() returns text
language sql stable
as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- Patient names are typed by hand, so "Mom", "mom" and " Mom " count as the same patient.
create or replace function public.same_person(text) returns text
language sql immutable
as $$ select lower(btrim(regexp_replace(coalesce($1, ''), '\s+', ' ', 'g'))) $$;

-- True when "the_owner" has shared this patient with the signed-in person.
create or replace function public.can_view_shift(the_owner uuid, the_person text) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.same_person(the_person) <> '' and public.my_email() <> '' and exists (
    select 1 from public.shares s
    where s.owner = the_owner
      and s.viewer_email = public.my_email()
      and public.same_person(s.person) = public.same_person(the_person)
  )
$$;

-- True when "the_owner" has shared any patient with the signed-in person (to show their name).
-- security definer lets the check read the shares table without opening it up to everyone.
create or replace function public.is_shared_with_me(the_owner uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.shares s
    where s.owner = the_owner and s.viewer_email = public.my_email() and public.my_email() <> ''
  )
$$;

-- The people you can message: everyone you share a patient with, and everyone who shares one with you.
-- A payer who hasn't signed in to Care Hours yet is listed with no id (they can't receive messages yet).
-- It reads emails from Supabase's own sign-in records, which people can't change, so nobody can
-- pretend to be a payer by typing that payer's email somewhere.
create or replace function public.my_contacts()
returns table (id uuid, email text, display_name text, phone text, role text)
language sql stable security definer set search_path = public
as $$
  select distinct on (c.email) c.id, c.email, coalesce(p.display_name, ''), coalesce(p.phone, ''), c.role
  from (
    select u.id, s.viewer_email as email, 'payer'::text as role
      from public.shares s left join auth.users u on lower(u.email) = s.viewer_email
      where s.owner = auth.uid()
    union
    select s.owner, lower(u.email), 'caregiver'::text
      from public.shares s join auth.users u on u.id = s.owner
      where s.viewer_email = public.my_email() and public.my_email() <> '' and s.owner <> auth.uid()
  ) c
  left join public.profiles p on p.id = c.id
  order by c.email, c.role
$$;

-- True when the signed-in person may send a message to "other".
create or replace function public.can_message(other uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select other is not null and other <> auth.uid() and exists (select 1 from public.my_contacts() c where c.id = other)
$$;

-- ---------- Access rules (row level security) ----------

alter table public.schedule enable row level security;
alter table public.shifts   enable row level security;
alter table public.shares   enable row level security;
alter table public.profiles enable row level security;

-- Shifts: owners do everything with their own rows.
drop policy if exists "owner manages own shifts" on public.shifts;
create policy "owner manages own shifts" on public.shifts
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- Shifts: people the owner shared a patient with can read that patient's shifts (never write).
drop policy if exists "shared viewers read shifts" on public.shifts;
create policy "shared viewers read shifts" on public.shifts
  for select to authenticated
  using (public.can_view_shift(owner, person));

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

-- Schedule: owners do everything with their own entries.
drop policy if exists "owner manages own schedule" on public.schedule;
create policy "owner manages own schedule" on public.schedule
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- Schedule: payers read scheduled shifts for patients shared with them, and the caregiver's time off.
drop policy if exists "shared viewers read schedule" on public.schedule;
create policy "shared viewers read schedule" on public.schedule
  for select to authenticated
  using (
    (kind <> 'off' and public.can_view_shift(owner, person))
    or (kind = 'off' and public.is_shared_with_me(owner))
  );

-- Messages: only the sender and the recipient can read them.
alter table public.messages enable row level security;
drop policy if exists "people read their own messages" on public.messages;
create policy "people read their own messages" on public.messages
  for select to authenticated
  using (sender = auth.uid() or recipient = auth.uid());

-- Messages: you can send only as yourself, and only to someone you share with (or who shares with you).
drop policy if exists "send to people you share with" on public.messages;
create policy "send to people you share with" on public.messages
  for insert to authenticated
  with check (sender = auth.uid() and public.can_message(recipient));

-- Messages: the recipient can mark a message read (and change nothing else, see the grants below).
drop policy if exists "recipient marks messages read" on public.messages;
create policy "recipient marks messages read" on public.messages
  for update to authenticated
  using (recipient = auth.uid())
  with check (recipient = auth.uid());

-- New messages appear right away on the other person's screen.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- Nobody who is signed out can touch any of this.
revoke all on public.shifts, public.shares, public.profiles, public.schedule from anon;
grant select, insert, update, delete on public.shifts, public.shares, public.profiles, public.schedule to authenticated;
grant execute on function public.my_email(), public.same_person(text), public.is_shared_with_me(uuid), public.can_view_shift(uuid, text) to authenticated;
revoke execute on function public.is_shared_with_me(uuid), public.can_view_shift(uuid, text) from anon, public;
-- Messages can be read, sent (only who it's to and what it says) and marked read; never edited or deleted.
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
grant insert (recipient, body) on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;
grant execute on function public.my_contacts(), public.can_message(uuid) to authenticated;
revoke execute on function public.my_contacts(), public.can_message(uuid) from anon, public;
