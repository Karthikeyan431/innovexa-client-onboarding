-- Website URLs are rendered as links in the admin dashboard: only allow http(s),
-- even for edits made directly through the API.
alter table public.applications
  add constraint applications_website_url_scheme
  check (website_url is null or website_url ~* '^https?://[^\s]+$');
