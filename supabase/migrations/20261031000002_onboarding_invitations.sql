-- Onboarding invitations: the team emails a prospective client a personal link
-- to the onboarding form. Only a hash of the link token is stored.

create table public.onboarding_invitations (
  id             uuid primary key default gen_random_uuid(),
  token_hash     text not null unique,
  email          citext not null check (char_length(email) <= 254),
  full_name      text not null check (char_length(full_name) between 2 and 120),
  company_name   text check (char_length(company_name) <= 160),
  message        text check (char_length(message) <= 2000),
  sent_by        uuid references public.admin_users (user_id) on delete set null,
  email_status   text not null default 'pending' check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  email_error    text,
  send_count     integer not null default 1,
  last_sent_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  application_id uuid references public.applications (id) on delete set null,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index onboarding_invitations_created_idx on public.onboarding_invitations (created_at desc);
create index onboarding_invitations_email_idx on public.onboarding_invitations (email);

alter table public.onboarding_invitations enable row level security;
revoke all on public.onboarding_invitations from anon, authenticated;

-- Admins see and cancel invitations; creating/resending happens in the API
-- (it needs to generate the token and send the email).
grant select, delete on public.onboarding_invitations to authenticated;
create policy "admins read invitations" on public.onboarding_invitations
  for select to authenticated using (public.is_admin());
create policy "admins cancel invitations" on public.onboarding_invitations
  for delete to authenticated using (public.is_admin());
