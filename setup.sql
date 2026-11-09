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
-- Version 8 adds Client/Patient cards (see the "Version 8" part at the end of this file).
--   * A client (the person who pays) is its own record, found by email and phone number together. Adding
--     a client who's already in Care Hours links to that client instead of making a second one.
--   * Each patient has one client; a client can have several patients.
--   * Adding a patient who's already in Care Hours (same name, date of birth and phone) sends that
--     patient's client a request. The caregiver is added only after the client approves it.
--   * Patient cards made before version 8 get a client record from the payer details on them.
-- If you ran version 7, run this whole file again. Nothing you already have is lost.
--
-- Version 7 lets several caregivers share one patient card.
--   * Once a patient is set up, only the payer or a caregiver already on the card can add another caregiver,
--     by email. Added caregivers can read and edit the card and log shifts for that patient.
--   * The caregiver who set up the card, or the payer, can remove an added caregiver; an added caregiver can
--     leave. Only the caregiver who set up the card can rename the patient or remove the card.
--   * A payer sees the card when any of its caregivers shares that patient with them.
--   * Nobody joins a card on their own (see version 8 for adding a patient who's already in Care Hours).
-- If you ran version 6, run this whole file again. Nothing you already have is changed.
--
-- Version 6 adds patient cards: name, date of birth, address, email, phone, notes, and who pays.
--   * The caregiver who creates a card owns it. Payers they share that patient with can read and edit it,
--     but only the caregiver can add a card, rename it or remove it.
-- If you ran version 5, run this whole file again. Nothing you already have is changed.
--
-- Version 5 lets a caregiver hold each week until they share it.
--   * With "Hold each week" on, payers see a caregiver's worked shifts only up to the "shared through" date.
--   * Sharing a week moves that date forward. The database never lets it move back, so a shared week
--     can't be unshared. The schedule isn't held; payers always see it.
-- If you ran version 4, run this whole file again. Nothing you already have is changed.
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

-- Version 5: hold each week until it's shared. Payers see shifts that start before shared_through.
alter table public.profiles add column if not exists hold_weeks boolean not null default false;
alter table public.profiles add column if not exists shared_through timestamptz;

-- A shared week can't be unshared: shared_through only ever moves forward.
create or replace function public.keep_shared_through() returns trigger
language plpgsql set search_path = public
as $$
begin
  if old.shared_through is not null and (new.shared_through is null or new.shared_through < old.shared_through) then
    raise exception 'A shared week can''t be unshared' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists keep_shared_through on public.profiles;
create trigger keep_shared_through before update on public.profiles
  for each row execute function public.keep_shared_through();

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

-- Patient cards. One per patient for each caregiver; "person" is the name used on shifts.
create table if not exists public.patients (
  owner               uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                  text        not null,
  person              text        not null check (char_length(btrim(person)) between 1 and 100),
  birth_date          date,
  address             text        not null default '' check (char_length(address) <= 500),
  email               text        not null default '' check (char_length(email) <= 200),
  phone               text        not null default '' check (char_length(phone) <= 30),
  notes               text        not null default '' check (char_length(notes) <= 5000),
  payer_same          boolean     not null default false,
  payer_name          text        not null default '' check (char_length(payer_name) <= 100),
  payer_address       text        not null default '' check (char_length(payer_address) <= 500),
  payer_email         text        not null default '' check (char_length(payer_email) <= 200),
  payer_phone         text        not null default '' check (char_length(payer_phone) <= 30),
  payer_relationship  text        not null default '' check (char_length(payer_relationship) <= 100),
  deleted             boolean     not null default false,
  updated_at          timestamptz not null default now(),
  primary key (owner, id)
);

-- Version 7: the other caregivers on a patient card, by email (they may not have signed up yet).
create table if not exists public.patient_members (
  owner         uuid        not null,
  id            text        not null,
  member_email  text        not null check (member_email = lower(btrim(member_email)) and position('@' in member_email) > 1),
  created_at    timestamptz not null default now(),
  primary key (owner, id, member_email),
  foreign key (owner, id) references public.patients (owner, id) on delete cascade
);
create index if not exists patient_members_email_idx on public.patient_members (member_email);

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

-- True when a caregiver has shared the week this shift starts in (always true when they don't hold weeks).
create or replace function public.shift_released(the_owner uuid, the_start timestamptz) returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from public.profiles p
    where p.id = the_owner and p.hold_weeks
      and (p.shared_through is null or the_start >= p.shared_through)
  )
$$;

-- True when the signed-in caregiver was added to this patient card.
create or replace function public.is_patient_member(the_owner uuid, the_id text) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.my_email() <> '' and exists (
    select 1 from public.patient_members m
    where m.owner = the_owner and m.id = the_id and m.member_email = public.my_email()
  )
$$;

-- True when a payer may see this card: the caregiver who set it up, or any caregiver on it,
-- shares that patient with them.
create or replace function public.can_view_patient(the_owner uuid, the_id text, the_person text) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_view_shift(the_owner, the_person) or exists (
    select 1 from public.patient_members m join auth.users u on lower(u.email) = m.member_email
    where m.owner = the_owner and m.id = the_id and public.can_view_shift(u.id, the_person)
  )
$$;

-- Who set up each patient card you can see (theirs is the name shown on the card).
create or replace function public.patient_card_owners()
returns table (owner uuid, name text)
language sql stable security definer set search_path = public
as $$
  select distinct p.owner, coalesce(nullif(pr.display_name, ''), u.email)
  from public.patients p
    join auth.users u on u.id = p.owner
    left join public.profiles pr on pr.id = p.owner
  where p.owner <> auth.uid() and not p.deleted
    and (public.is_patient_member(p.owner, p.id) or public.can_view_patient(p.owner, p.id, p.person))
$$;

-- Earlier drafts let a matching patient join a card on its own; that's gone.
drop function if exists public.join_matching_patient(text, date, text);

-- The payer of a card: someone a caregiver on the card shares that patient with.
create or replace function public.is_card_payer(the_owner uuid, the_id text) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.patients p
    where p.owner = the_owner and p.id = the_id and not p.deleted
      and public.can_view_patient(p.owner, p.id, p.person)
  )
$$;

-- Who can add caregivers to a card (and see who's on it): the caregiver who set it up, a caregiver
-- already on it, or its payer.
create or replace function public.can_add_card_caregiver(the_owner uuid, the_id text) returns boolean
language sql stable security definer set search_path = public
as $$
  select the_owner = auth.uid() or public.is_patient_member(the_owner, the_id) or public.is_card_payer(the_owner, the_id)
$$;

-- Payers can edit a patient card, but only the caregiver who owns it can rename or remove it.
create or replace function public.guard_patient_edit() returns trigger
language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() <> old.owner and (
       new.owner <> old.owner or new.id <> old.id or new.deleted <> old.deleted
       or public.same_person(new.person) <> public.same_person(old.person)) then
    raise exception 'Only the caregiver can rename or remove a patient' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists guard_patient_edit on public.patients;
create trigger guard_patient_edit before update on public.patients
  for each row execute function public.guard_patient_edit();

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
  using (public.can_view_shift(owner, person) and public.shift_released(owner, start_at));

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

-- Patient cards: the caregiver manages their own.
alter table public.patients enable row level security;
drop policy if exists "owner manages own patients" on public.patients;
create policy "owner manages own patients" on public.patients
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- Patient cards: caregivers added to a card, and payers of a patient shared with them, read and edit it
-- (they can't add or remove a card, or rename the patient; see guard_patient_edit).
drop policy if exists "shared viewers read patients" on public.patients;
create policy "shared viewers read patients" on public.patients
  for select to authenticated
  using (public.is_patient_member(owner, id) or public.can_view_patient(owner, id, person));
drop policy if exists "shared viewers edit patients" on public.patients;
create policy "shared viewers edit patients" on public.patients
  for update to authenticated
  using (public.is_patient_member(owner, id) or public.can_view_patient(owner, id, person))
  with check (public.is_patient_member(owner, id) or public.can_view_patient(owner, id, person));

-- Caregivers on a card. (Names from earlier drafts are dropped first.)
alter table public.patient_members enable row level security;
drop policy if exists "owner manages card caregivers" on public.patient_members;
drop policy if exists "card caregivers see each other" on public.patient_members;
drop policy if exists "card caregivers can leave" on public.patient_members;
-- The caregiver who set up the card, the caregivers on it and its payer see who's on it.
drop policy if exists "card people see its caregivers" on public.patient_members;
create policy "card people see its caregivers" on public.patient_members
  for select to authenticated
  using (public.can_add_card_caregiver(owner, id));
-- They can also add another caregiver (never themselves).
drop policy if exists "card people add caregivers" on public.patient_members;
create policy "card people add caregivers" on public.patient_members
  for insert to authenticated
  with check (public.can_add_card_caregiver(owner, id) and member_email <> public.my_email());
-- The caregiver who set up the card, or its payer, removes a caregiver; an added caregiver can leave.
drop policy if exists "card caregivers removed or leave" on public.patient_members;
create policy "card caregivers removed or leave" on public.patient_members
  for delete to authenticated
  using (owner = auth.uid() or public.is_card_payer(owner, id)
         or (member_email = public.my_email() and public.my_email() <> ''));

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
revoke all on public.shifts, public.shares, public.profiles, public.schedule, public.patients from anon;
grant select, insert, update, delete on public.shifts, public.shares, public.profiles, public.schedule, public.patients to authenticated;
grant execute on function public.my_email(), public.same_person(text), public.is_shared_with_me(uuid), public.can_view_shift(uuid, text) to authenticated;
revoke execute on function public.is_shared_with_me(uuid), public.can_view_shift(uuid, text) from anon, public;
-- Messages can be read, sent (only who it's to and what it says) and marked read; never edited or deleted.
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
grant insert (recipient, body) on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;
grant execute on function public.my_contacts(), public.can_message(uuid) to authenticated;
revoke execute on function public.my_contacts(), public.can_message(uuid) from anon, public;
grant execute on function public.shift_released(uuid, timestamptz) to authenticated;
revoke execute on function public.shift_released(uuid, timestamptz) from anon, public;
-- Version 7: shared patient cards.
revoke all on public.patient_members from anon;
grant select, insert, delete on public.patient_members to authenticated;
grant execute on function public.is_patient_member(uuid, text), public.can_view_patient(uuid, text, text), public.patient_card_owners(),
  public.is_card_payer(uuid, text), public.can_add_card_caregiver(uuid, text) to authenticated;
revoke execute on function public.is_patient_member(uuid, text), public.can_view_patient(uuid, text, text), public.patient_card_owners(),
  public.is_card_payer(uuid, text), public.can_add_card_caregiver(uuid, text) from anon, public;

-- ======================================================================================
-- Version 8: Client/Patient cards
-- ======================================================================================

-- A client: the person who pays for a patient's care. Found by email and phone together, so the same
-- client is never added twice (the unique index below).
create table if not exists public.clients (
  owner       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        primary key,
  name        text        not null default '' check (char_length(name) <= 100),
  address     text        not null default '' check (char_length(address) <= 500),
  email       text        not null default '' check (email = lower(btrim(email)) and char_length(email) <= 200),
  phone       text        not null default '' check (char_length(phone) <= 30),
  deleted     boolean     not null default false,
  updated_at  timestamptz not null default now()
);
create unique index if not exists clients_email_phone_key on public.clients (email, phone)
  where email <> '' and phone <> '' and not deleted;

-- Each patient card points to its client. (The relationship to the patient stays on the patient card.)
alter table public.patients add column if not exists client_id text references public.clients (id) on delete set null;

-- Requests to be added to a patient who's already in Care Hours; the patient's client approves them.
create table if not exists public.patient_requests (
  owner            uuid        not null,
  id               text        not null,
  requester        uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  requester_email  text        not null default '',
  requester_name   text        not null default '',
  person           text        not null default '',
  created_at       timestamptz not null default now(),
  primary key (owner, id, requester),
  foreign key (owner, id) references public.patients (owner, id) on delete cascade
);
create index if not exists patient_requests_requester_idx on public.patient_requests (requester);

-- True when the signed-in person is the client of this patient card (their email is the client's).
create or replace function public.is_card_client(the_owner uuid, the_id text) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.my_email() <> '' and exists (
    select 1 from public.patients p join public.clients c on c.id = p.client_id
    where p.owner = the_owner and p.id = the_id and not p.deleted and not c.deleted and c.email = public.my_email()
  )
$$;

-- The client of a card, a caregiver on it and its payer can add caregivers (now including the client).
create or replace function public.can_add_card_caregiver(the_owner uuid, the_id text) returns boolean
language sql stable security definer set search_path = public
as $$
  select the_owner = auth.uid() or public.is_patient_member(the_owner, the_id)
      or public.is_card_payer(the_owner, the_id) or public.is_card_client(the_owner, the_id)
$$;

-- Who can see and edit a client: the caregiver who added it, the client themselves, and everyone who
-- can see a patient card linked to it (its caregivers and payers).
create or replace function public.can_see_client(the_id text) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
      select 1 from public.clients c
      where c.id = the_id and (c.owner = auth.uid() or (public.my_email() <> '' and c.email = public.my_email()))
    ) or exists (
      select 1 from public.patients p
      where p.client_id = the_id and not p.deleted
        and (p.owner = auth.uid() or public.is_patient_member(p.owner, p.id) or public.can_view_patient(p.owner, p.id, p.person))
    )
$$;

-- Only the caregiver who added a client can remove it.
create or replace function public.guard_client_edit() returns trigger
language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() <> old.owner and (new.owner <> old.owner or new.id <> old.id or new.deleted <> old.deleted) then
    raise exception 'Only the caregiver who added a client can remove it' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists guard_client_edit on public.clients;
create trigger guard_client_edit before update on public.clients
  for each row execute function public.guard_client_edit();

-- Is this client already in Care Hours? Matches email and phone together; both must be given.
-- Returns that client, so a new patient can be linked to it instead of adding the client again.
create or replace function public.find_client(the_email text, the_phone text)
returns table (id text, name text, address text, email text, phone text)
language sql stable security definer set search_path = public
as $$
  select c.id, c.name, c.address, c.email, c.phone from public.clients c
  where auth.uid() is not null and lower(btrim(the_email)) <> '' and btrim(the_phone) <> ''
    and not c.deleted and c.email = lower(btrim(the_email)) and c.phone = btrim(the_phone)
  limit 1
$$;

-- Adding a patient who's already in Care Hours (name, date of birth and phone all match another
-- caregiver's card): send that patient's client a request instead of adding the patient again.
-- Answers 'requested', 'already' (already on the card or already asked) or 'none' (no match).
create or replace function public.request_patient(the_person text, the_birth date, the_phone text) returns text
language plpgsql volatile security definer set search_path = public
as $$
declare hit record; nm text;
begin
  if auth.uid() is null or public.my_email() = '' or the_birth is null
     or coalesce(btrim(the_phone), '') = '' or public.same_person(the_person) = '' then
    return 'none';
  end if;
  select p.owner, p.id into hit from public.patients p
  where not p.deleted and p.owner <> auth.uid()
    and public.same_person(p.person) = public.same_person(the_person)
    and p.birth_date = the_birth and p.phone = btrim(the_phone)
  order by p.updated_at, p.owner, p.id limit 1;
  if not found then return 'none'; end if;
  if public.is_patient_member(hit.owner, hit.id)
     or exists (select 1 from public.patient_requests r where r.owner = hit.owner and r.id = hit.id and r.requester = auth.uid()) then
    return 'already';
  end if;
  select coalesce(nullif(display_name, ''), '') into nm from public.profiles where profiles.id = auth.uid();
  insert into public.patient_requests (owner, id, requester, requester_email, requester_name, person)
    values (hit.owner, hit.id, auth.uid(), public.my_email(), coalesce(nm, ''), btrim(the_person));
  return 'requested';
end
$$;

-- The patient's client approves a request: the caregiver is added to the card.
create or replace function public.approve_patient_request(the_owner uuid, the_id text, the_requester uuid) returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare em text;
begin
  if not public.is_card_client(the_owner, the_id) then
    raise exception 'Only the patient''s client can approve this' using errcode = '42501';
  end if;
  select r.requester_email into em from public.patient_requests r
  where r.owner = the_owner and r.id = the_id and r.requester = the_requester;
  if em is null then return false; end if;
  insert into public.patient_members (owner, id, member_email) values (the_owner, the_id, em) on conflict do nothing;
  delete from public.patient_requests where owner = the_owner and id = the_id and requester = the_requester;
  return true;
end
$$;

-- Clients: seen and edited by the people above; added by caregivers as themselves; never deleted outright.
alter table public.clients enable row level security;
drop policy if exists "people on the card see the client" on public.clients;
create policy "people on the card see the client" on public.clients
  for select to authenticated using (public.can_see_client(id));
drop policy if exists "caregivers add clients" on public.clients;
create policy "caregivers add clients" on public.clients
  for insert to authenticated with check (owner = auth.uid());
drop policy if exists "people on the card edit the client" on public.clients;
create policy "people on the card edit the client" on public.clients
  for update to authenticated using (public.can_see_client(id)) with check (public.can_see_client(id));

-- Requests: the caregiver who asked sees their own (and can cancel); the patient's client sees them
-- (and declines by removing one, or approves with approve_patient_request). Made only by request_patient.
alter table public.patient_requests enable row level security;
drop policy if exists "requests seen by the asker and the client" on public.patient_requests;
create policy "requests seen by the asker and the client" on public.patient_requests
  for select to authenticated using (requester = auth.uid() or public.is_card_client(owner, id));
drop policy if exists "requests removed by the asker or the client" on public.patient_requests;
create policy "requests removed by the asker or the client" on public.patient_requests
  for delete to authenticated using (requester = auth.uid() or public.is_card_client(owner, id));

-- Clients of the patients shared with a payer can also see those patient cards.
drop policy if exists "clients read their patients" on public.patients;
create policy "clients read their patients" on public.patients
  for select to authenticated using (public.is_card_client(owner, id));
drop policy if exists "clients edit their patients" on public.patients;
create policy "clients edit their patients" on public.patients
  for update to authenticated using (public.is_card_client(owner, id)) with check (public.is_card_client(owner, id));

-- Patient cards from before version 8: make a client record from the payer details on each card
-- (reusing a client with the same email and phone). Runs once per card; safe to run again.
do $$
declare p record; em text; ph text; nm text; ad text; cid text;
begin
  for p in select * from public.patients where client_id is null and not deleted
             and (payer_same or payer_name <> '' or payer_email <> '' or payer_phone <> '') loop
    em := lower(btrim(case when p.payer_same then p.email else p.payer_email end));
    ph := btrim(case when p.payer_same then p.phone else p.payer_phone end);
    nm := case when p.payer_same then p.person else p.payer_name end;
    ad := case when p.payer_same then p.address else p.payer_address end;
    cid := null;
    if em <> '' and ph <> '' then
      select c.id into cid from public.clients c where c.email = em and c.phone = ph and not c.deleted;
    end if;
    if cid is null then
      cid := 'c-' || md5(p.owner::text || '|' || p.id);
      insert into public.clients (owner, id, name, address, email, phone) values (p.owner, cid, nm, ad, em, ph)
        on conflict (id) do nothing;
    end if;
    update public.patients set client_id = cid, updated_at = now() where owner = p.owner and id = p.id;
  end loop;
end $$;

-- An earlier draft's check is replaced by request_patient.
drop function if exists public.patient_exists(text, date, text);

revoke all on public.clients, public.patient_requests from anon;
grant select, insert, update on public.clients to authenticated;
grant select, delete on public.patient_requests to authenticated;
grant execute on function public.is_card_client(uuid, text), public.can_see_client(text), public.find_client(text, text),
  public.request_patient(text, date, text), public.approve_patient_request(uuid, text, uuid) to authenticated;
revoke execute on function public.is_card_client(uuid, text), public.can_see_client(text), public.find_client(text, text),
  public.request_patient(text, date, text), public.approve_patient_request(uuid, text, uuid) from anon, public;
