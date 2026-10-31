// Admin data access. All reads/writes run as the signed-in user, so Postgres
// RLS (is_admin()) — not this code — decides what is visible or editable.
import { createClient } from '@supabase/supabase-js';
import type { Status } from '../shared/schema';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && anonKey);
export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

export interface AppRow {
  id: string;
  reference: string;
  status: Status;
  full_name: string;
  designation: string | null;
  email: string;
  phone: string;
  preferred_contact: string;
  company_name: string;
  industry: string;
  location: string | null;
  has_website: boolean;
  website_url: string | null;
  website_requirements: string | null;
  business_description: string | null;
  services: string[];
  other_services: string | null;
  project_requirements: string;
  budget_range: string | null;
  timeline: string | null;
  additional_notes: string | null;
  signature_path: string;
  pdf_path: string | null;
  assigned_to: string | null;
  acknowledged_at: string;
  submitted_at: string;
  updated_at: string;
}

export interface TeamMember { user_id: string; full_name: string; email: string; role: string; active: boolean }

export interface ListQuery {
  q: string;
  status: string;
  service: string;
  assigned: string;
  from: string; // yyyy-mm-dd
  to: string;
  sort: 'submitted_at' | 'full_name' | 'company_name' | 'status' | 'budget_range';
  dir: 'asc' | 'desc';
  page: number;
}

export const PAGE_SIZE = 20;
const LIST_COLUMNS = 'id, reference, status, full_name, email, phone, company_name, services, budget_range, submitted_at, assigned_to';

// PostgREST filter syntax treats , ( ) as structure — strip them from search text.
const cleanSearch = (q: string) => q.replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 80);

function dayStart(d: string): string { return new Date(`${d}T00:00:00`).toISOString(); }
function dayEnd(d: string): string {
  const t = new Date(`${d}T00:00:00`);
  t.setDate(t.getDate() + 1);
  return t.toISOString();
}

function applyFilters<T extends { neq: Function; eq: Function; contains: Function; gte: Function; lt: Function; or: Function; is: Function }>(query: T, q: ListQuery): T {
  let r: any = query.neq('status', 'draft');
  if (q.status) r = r.eq('status', q.status);
  if (q.service) r = r.contains('services', [q.service]);
  if (q.assigned === 'unassigned') r = r.is('assigned_to', null);
  else if (q.assigned) r = r.eq('assigned_to', q.assigned);
  if (q.from) r = r.gte('submitted_at', dayStart(q.from));
  if (q.to) r = r.lt('submitted_at', dayEnd(q.to));
  const s = cleanSearch(q.q);
  if (s) {
    const like = `%${s}%`;
    r = r.or(['full_name', 'company_name', 'email', 'reference', 'phone'].map((c) => `${c}.ilike.${like}`).join(','));
  }
  return r;
}

export async function listApplications(q: ListQuery) {
  const from = (q.page - 1) * PAGE_SIZE;
  let query = applyFilters(supabase.from('applications').select(LIST_COLUMNS, { count: 'exact' }), q)
    .order(q.sort, { ascending: q.dir === 'asc' });
  if (q.sort !== 'submitted_at') query = query.order('submitted_at', { ascending: false });
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: (data ?? []) as Partial<AppRow>[], total: count ?? 0 };
}

export async function exportApplications(q: ListQuery): Promise<AppRow[]> {
  const out: AppRow[] = [];
  for (let from = 0; from < 10_000; from += 1000) {
    const { data, error } = await applyFilters(supabase.from('applications').select('*'), q)
      .order(q.sort, { ascending: q.dir === 'asc' })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as AppRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function stats(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('admin_dashboard_stats');
  if (error) throw error;
  return data as Record<string, number>;
}

export async function recent(limit = 6) {
  const { data, error } = await supabase.from('applications').select(LIST_COLUMNS).neq('status', 'draft')
    .order('submitted_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as Partial<AppRow>[];
}

export async function getApplication(id: string) {
  const [app, files, notes, history, emails] = await Promise.all([
    supabase.from('applications').select('*').eq('id', id).maybeSingle(),
    supabase.from('application_attachments').select('*').eq('application_id', id).order('created_at'),
    supabase.from('application_notes').select('*').eq('application_id', id).order('created_at', { ascending: false }),
    supabase.from('application_status_history').select('*').eq('application_id', id).order('created_at', { ascending: false }),
    supabase.from('email_events').select('kind, recipient, status, error, created_at').eq('application_id', id).order('created_at', { ascending: false }).limit(20),
  ]);
  for (const r of [app, files, notes, history, emails]) if (r.error) throw r.error;
  return {
    app: app.data as AppRow | null,
    files: (files.data ?? []) as { id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number }[],
    notes: (notes.data ?? []) as { id: string; author_id: string | null; body: string; created_at: string }[],
    history: (history.data ?? []) as { id: string; from_status: Status | null; to_status: Status; changed_by: string | null; note: string | null; created_at: string }[],
    emails: (emails.data ?? []) as { kind: string; recipient: string; status: string; error: string | null; created_at: string }[],
  };
}

let teamCache: TeamMember[] | null = null;
export async function team(): Promise<TeamMember[]> {
  if (teamCache) return teamCache;
  const { data, error } = await supabase.from('admin_users').select('user_id, full_name, email, role, active').order('full_name');
  if (error) throw error;
  teamCache = (data ?? []) as TeamMember[];
  return teamCache;
}

export async function updateApplication(id: string, patch: Partial<AppRow>) {
  const { data, error } = await supabase.from('applications').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data as AppRow;
}

export async function addNote(applicationId: string, body: string, authorId: string) {
  const { error } = await supabase.from('application_notes').insert({ application_id: applicationId, body, author_id: authorId });
  if (error) throw error;
}

export async function signedUrl(bucket: string, path: string, download?: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300, download ? { download } : undefined);
  if (error || !data) throw error ?? new Error('No URL');
  return data.signedUrl;
}

async function authedFetch(path: string, body: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Request failed (${res.status})`);
  }
  return res;
}

export async function changeStatus(body: { applicationId: string; status: Status; note: string; notifyClient: boolean; clientMessage: string }) {
  return (await authedFetch('/api/admin/status', body)).json() as Promise<{ application: AppRow; email: string }>;
}

export async function deleteApplication(applicationId: string) {
  return (await authedFetch('/api/admin/delete', { applicationId })).json() as Promise<{ deleted: boolean; filesRemaining: number }>;
}

export async function adminPdf(applicationId: string): Promise<Blob> {
  return (await authedFetch('/api/admin/pdf', { applicationId })).blob();
}

export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}
