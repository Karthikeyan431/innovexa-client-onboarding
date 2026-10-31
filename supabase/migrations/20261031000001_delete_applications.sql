-- Permanent deletion of applications by owners/admins, with an audit trail.

create table public.admin_audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.admin_users (user_id) on delete set null,
  action     text not null,
  target     text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;
create policy "admins read audit log" on public.admin_audit_log
  for select to authenticated using (public.is_admin());

-- Owners and admins (not members) may delete.
create or replace function public.can_delete_applications()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and active and role in ('owner', 'admin')
  );
$$;

revoke all on function public.can_delete_applications() from public, anon, authenticated;
grant execute on function public.can_delete_applications() to authenticated;

-- Deletes an application and everything attached to it (notes, history,
-- attachment rows and email events cascade), removes the client record when no
-- other application references it, and records the deletion. Returns the
-- storage paths so the caller can remove the files.
create or replace function public.delete_application(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications;
  v_paths jsonb;
begin
  if not public.can_delete_applications() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;

  v_paths := jsonb_build_object(
    'signatures', jsonb_build_array(v_app.signature_path),
    'documents', case when v_app.pdf_path is null then '[]'::jsonb else jsonb_build_array(v_app.pdf_path) end,
    'attachments', coalesce((
      select jsonb_agg(storage_path) from public.application_attachments where application_id = p_application_id
    ), '[]'::jsonb)
  );

  delete from public.applications where id = p_application_id;
  delete from public.clients c
    where c.id = v_app.client_id
      and not exists (select 1 from public.applications a where a.client_id = c.id);

  insert into public.admin_audit_log (actor_id, action, target, details)
  values ((select auth.uid()), 'application.deleted', v_app.reference, jsonb_build_object(
    'company', v_app.company_name,
    'status', v_app.status,
    'submitted_at', v_app.submitted_at
  ));

  return v_paths;
end;
$$;

revoke all on function public.delete_application(uuid) from public, anon, authenticated;
grant execute on function public.delete_application(uuid) to authenticated;
