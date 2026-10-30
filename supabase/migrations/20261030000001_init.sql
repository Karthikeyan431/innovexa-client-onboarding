-- Innovexa Digital client onboarding — core schema.
-- Public submissions never touch these tables directly: the /api functions use the
-- service role after server-side validation. Admins read and edit through RLS.

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.application_status as enum (
  'draft', 'submitted', 'under_review', 'contacted', 'proposal_sent',
  'approved', 'in_progress', 'completed', 'rejected'
);

create type public.admin_role as enum ('owner', 'admin', 'member');

-- ---------------------------------------------------------------------------
-- Admin users (Innovexa team). Membership here — not a JWT claim or a client
-- flag — is what grants dashboard access.
-- ---------------------------------------------------------------------------
create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      citext not null unique,
  full_name  text not null check (char_length(full_name) between 1 and 120),
  role       public.admin_role not null default 'member',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and active
  );
$$;

revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Clients: one row per distinct email address. Created on first submission and
-- never overwritten by later public submissions (an anonymous submitter must
-- not be able to change an existing client's record).
-- ---------------------------------------------------------------------------
create table public.clients (
  id           uuid primary key default gen_random_uuid(),
  email        citext not null unique,
  full_name    text not null,
  company_name text not null,
  phone        text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Applications: the submitted onboarding form, as signed.
-- ---------------------------------------------------------------------------
create table public.applications (
  id                      uuid primary key default gen_random_uuid(),
  reference               text not null unique check (reference ~ '^INX-[0-9]{4}-[A-Z0-9]{6}$'),
  client_id               uuid not null references public.clients (id) on delete restrict,
  status                  public.application_status not null default 'submitted',

  -- Step 1 — contact
  full_name               text not null check (char_length(full_name) between 2 and 120),
  designation             text check (char_length(designation) <= 120),
  email                   citext not null check (char_length(email) <= 254),
  phone                   text not null check (char_length(phone) between 7 and 20),
  preferred_contact       text not null check (preferred_contact in ('Email', 'Phone', 'WhatsApp')),

  -- Step 2 — business
  company_name            text not null check (char_length(company_name) between 1 and 160),
  industry                text not null check (char_length(industry) <= 80),
  location                text check (char_length(location) <= 160),
  has_website             boolean not null,
  website_url             text check (char_length(website_url) <= 300),
  website_requirements    text check (char_length(website_requirements) <= 4000),
  business_description    text check (char_length(business_description) <= 4000),

  -- Step 3 — project
  services                text[] not null check (cardinality(services) between 1 and 12),
  other_services          text check (char_length(other_services) <= 300),
  project_requirements    text not null check (char_length(project_requirements) between 20 and 8000),
  budget_range            text check (char_length(budget_range) <= 60),
  timeline                text check (char_length(timeline) <= 60),
  additional_notes        text check (char_length(additional_notes) <= 4000),

  -- Step 4 — acknowledgement & signature
  acknowledged_at         timestamptz not null,
  signature_path          text not null,
  pdf_path                text,

  -- Internal
  assigned_to             uuid references public.admin_users (user_id) on delete set null,
  idempotency_key         uuid not null unique,
  access_token_hash       text not null,
  access_token_expires_at timestamptz not null,
  ip_hash                 text,
  user_agent              text check (char_length(user_agent) <= 400),
  submitted_at            timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index applications_status_idx       on public.applications (status);
create index applications_submitted_at_idx on public.applications (submitted_at desc);
create index applications_client_idx       on public.applications (client_id);
create index applications_assigned_idx     on public.applications (assigned_to);
create index applications_services_idx     on public.applications using gin (services);
create index applications_ip_recent_idx    on public.applications (ip_hash, submitted_at desc);

create table public.application_attachments (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  storage_path   text not null unique,
  file_name      text not null check (char_length(file_name) <= 200),
  mime_type      text not null,
  size_bytes     integer not null check (size_bytes > 0),
  created_at     timestamptz not null default now()
);
create index application_attachments_app_idx on public.application_attachments (application_id);

-- Internal notes — never exposed to clients (no anon access, not in PDF/emails).
create table public.application_notes (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  author_id      uuid references public.admin_users (user_id) on delete set null default auth.uid(),
  body           text not null check (char_length(body) between 1 and 4000),
  created_at     timestamptz not null default now()
);
create index application_notes_app_idx on public.application_notes (application_id, created_at desc);

create table public.application_status_history (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  from_status    public.application_status,
  to_status      public.application_status not null,
  changed_by     uuid references public.admin_users (user_id) on delete set null,
  note           text check (char_length(note) <= 1000),
  created_at     timestamptz not null default now()
);
create index application_status_history_app_idx on public.application_status_history (application_id, created_at desc);

create table public.email_events (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications (id) on delete cascade,
  kind           text not null,
  recipient      text not null,
  status         text not null check (status in ('sent', 'failed', 'skipped')),
  provider_id    text,
  error          text,
  created_at     timestamptz not null default now()
);
create index email_events_app_idx on public.email_events (application_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger applications_touch before update on public.applications
  for each row execute function public.touch_updated_at();

create or replace function public.log_initial_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.application_status_history (application_id, from_status, to_status, note)
  values (new.id, null, new.status, 'Application submitted');
  return new;
end;
$$;

create trigger applications_initial_status after insert on public.applications
  for each row execute function public.log_initial_status();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Status changes go through this function so every change is authorised by the
-- database and recorded in the history in the same transaction.
create or replace function public.set_application_status(
  p_application_id uuid,
  p_status public.application_status,
  p_note text default null
)
returns public.applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.application_status;
  v_row public.applications;
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select status into v_old from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;

  if v_old = p_status then
    select * into v_row from public.applications where id = p_application_id;
    return v_row;
  end if;

  update public.applications set status = p_status where id = p_application_id
  returning * into v_row;

  insert into public.application_status_history (application_id, from_status, to_status, changed_by, note)
  values (p_application_id, v_old, p_status, (select auth.uid()), nullif(btrim(p_note), ''));

  return v_row;
end;
$$;

revoke all on function public.set_application_status(uuid, public.application_status, text) from public, anon, authenticated;
grant execute on function public.set_application_status(uuid, public.application_status, text) to authenticated;

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'total_clients',     (select count(*) from public.clients),
      'total_submissions', count(*),
      'new_submissions',   count(*) filter (where submitted_at >= now() - interval '7 days'),
      'pending_reviews',   count(*) filter (where status in ('submitted', 'under_review')),
      'proposals_sent',    count(*) filter (where status = 'proposal_sent'),
      'approved',          count(*) filter (where status = 'approved'),
      'active',            count(*) filter (where status = 'in_progress'),
      'completed',         count(*) filter (where status = 'completed')
    )
    from public.applications
    where status <> 'draft'
  );
end;
$$;

revoke all on function public.admin_dashboard_stats() from public, anon, authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.admin_users               enable row level security;
alter table public.clients                   enable row level security;
alter table public.applications              enable row level security;
alter table public.application_attachments   enable row level security;
alter table public.application_notes         enable row level security;
alter table public.application_status_history enable row level security;
alter table public.email_events              enable row level security;

-- Nothing is granted to anon. Authenticated users only see data if they are an
-- active admin. Privileges are granted narrowly on top of RLS.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.admin_users to authenticated;
create policy "admins read team" on public.admin_users
  for select to authenticated using (public.is_admin());

grant select on public.clients to authenticated;
create policy "admins read clients" on public.clients
  for select to authenticated using (public.is_admin());

-- Admins may edit permitted contact/business fields and the assignment. Status
-- is deliberately excluded: it changes only via set_application_status().
grant select on public.applications to authenticated;
grant update (
  full_name, designation, phone, preferred_contact, company_name, industry,
  location, website_url, business_description, assigned_to
) on public.applications to authenticated;
create policy "admins read applications" on public.applications
  for select to authenticated using (public.is_admin());
create policy "admins edit applications" on public.applications
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.application_attachments to authenticated;
create policy "admins read attachments" on public.application_attachments
  for select to authenticated using (public.is_admin());

grant select, insert on public.application_notes to authenticated;
create policy "admins read notes" on public.application_notes
  for select to authenticated using (public.is_admin());
create policy "admins add notes" on public.application_notes
  for insert to authenticated with check (public.is_admin() and author_id = (select auth.uid()));

grant select on public.application_status_history to authenticated;
create policy "admins read status history" on public.application_status_history
  for select to authenticated using (public.is_admin());

grant select on public.email_events to authenticated;
create policy "admins read email events" on public.email_events
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage: three private buckets. Uploads happen through short-lived signed
-- upload URLs issued by the server; only admins can read objects.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('attachments', 'attachments', false, 10485760, array[
    'application/pdf', 'image/png', 'image/jpeg', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip', 'application/x-zip-compressed'
  ]),
  ('signatures', 'signatures', false, 1048576, array['image/png']),
  ('documents', 'documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "admins read onboarding files" on storage.objects
  for select to authenticated
  using (bucket_id in ('attachments', 'signatures', 'documents') and public.is_admin());
