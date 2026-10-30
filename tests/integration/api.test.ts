// Integration tests against a running stack: `npx supabase start`, the mock
// Resend server (scripts/mock-resend.mjs) and `npm run dev`.
// Run with: INTEGRATION=1 npx vitest run tests/integration
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { makePng, signatureInk, validForm } from '../helpers';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const SB_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const EMAIL_LOG = 'test-results/emails.jsonl';

const sigUrl = (ink = signatureInk) => `data:image/png;base64,${Buffer.from(makePng(400, 120, ink)).toString('base64')}`;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const submit = (over: Record<string, unknown> = {}) =>
  post('/api/applications', { idempotencyKey: randomUUID(), form: validForm, signature: sigUrl(), attachments: [], ...over });
const emails = () => (existsSync(EMAIL_LOG) ? readFileSync(EMAIL_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const service = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(SB_URL, ANON, { auth: { persistSession: false } });

async function signIn(email: string, password: string) {
  const c = createClient(SB_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client: c, token: data.session!.access_token, userId: data.user!.id };
}

describe.runIf(process.env.INTEGRATION)('onboarding API', () => {
  let first: { id: string; reference: string; accessToken: string };

  beforeAll(() => {
    if (existsSync(EMAIL_LOG)) unlinkSync(EMAIL_LOG);
  });

  it('accepts a complete valid submission and stores everything', async () => {
    const res = await submit();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reference).toMatch(/^INX-\d{4}-[A-Z0-9]{6}$/);
    expect(body.accessToken.length).toBeGreaterThan(30);
    expect(body.pdfReady).toBe(true);
    first = body;

    const { data: row } = await service.from('applications').select('*').eq('id', body.id).single();
    expect(row).toMatchObject({ status: 'submitted', full_name: 'Priya Raman', email: 'priya@example.com', has_website: false });
    expect(row.services).toEqual(validForm.services);
    expect(row.access_token_hash).not.toBe(body.accessToken); // only the hash is stored
    expect(row.pdf_path).toBe(`${body.id}/${body.reference}.pdf`);

    const sig = await service.storage.from('signatures').download(row.signature_path);
    expect(sig.data!.size).toBeGreaterThan(500);
    const { data: hist } = await service.from('application_status_history').select('*').eq('application_id', body.id);
    expect(hist).toHaveLength(1);
  });

  it('sends the admin alert and client confirmation with the PDF attached', async () => {
    const sent = emails();
    const client = sent.find((e) => e.to?.[0] === 'priya@example.com');
    const admin = sent.find((e) => e.to?.[0] === 'team@innovexadigital.in');
    expect(client?.subject).toContain(first.reference);
    expect(admin?.subject).toContain('Raman Organics');
    expect(client.attachments[0].filename).toBe(`Innovexa-Application-${first.reference}.pdf`);
    expect(Buffer.from(client.attachments[0].content, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(client.html).toContain('What happens next');
    expect(admin.html).toContain(`/admin/#/applications/${first.id}`);
    const { data: ev } = await service.from('email_events').select('status').eq('application_id', first.id);
    expect(ev!.map((e) => e.status)).toEqual(['sent', 'sent']);
  });

  it('returns the same application for a duplicate submission (idempotency)', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([submit({ idempotencyKey: key }), submit({ idempotencyKey: key })]);
    const [ja, jb] = [await a.json(), await b.json()];
    expect(ja.reference).toBe(jb.reference);
    const again = await (await submit({ idempotencyKey: key })).json();
    expect(again.replayed).toBe(true);
    expect(again.reference).toBe(ja.reference);
    const { count } = await service.from('applications').select('id', { count: 'exact', head: true }).eq('idempotency_key', key);
    expect(count).toBe(1);
  });

  it('rejects missing fields, invalid email and phone with field errors', async () => {
    const res = await submit({ form: { ...validForm, email: 'nope', phone: '1', companyName: '', services: [] } });
    expect(res.status).toBe(422);
    const { fieldErrors } = await res.json();
    expect(Object.keys(fieldErrors).sort()).toEqual(['companyName', 'email', 'phone', 'services']);
  });

  it('rejects a missing, blank or tap-only signature', async () => {
    for (const signature of [undefined, sigUrl(() => false), sigUrl((x, y) => Math.hypot(x - 200, y - 60) < 3), 'data:image/svg+xml;base64,PHN2Zz4=']) {
      const res = await submit({ signature });
      expect(res.status).toBe(422);
      expect((await res.json()).fieldErrors.signature).toBeTruthy();
    }
  });

  it('rejects bots via the honeypot and oversized bodies', async () => {
    expect((await submit({ website: 'http://spam.example' })).status).toBe(400);
    expect((await submit({ form: { ...validForm, projectRequirements: 'x'.repeat(1_100_000) } })).status).toBe(413);
  });

  it('uploads attachments via signed URLs and links them to the application', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4\n% test brief\n');
    const up = await (await post('/api/uploads', { files: [{ name: 'brief.pdf', size: pdfBytes.length, type: 'application/pdf' }] })).json();
    const fd = new FormData();
    fd.append('', new Blob([pdfBytes], { type: 'application/pdf' }), 'brief.pdf');
    const put = await fetch(up.uploads[0].signedUrl, { method: 'PUT', body: fd });
    expect(put.status).toBe(200);
    const res = await submit({ uploadSession: up.session, attachments: [{ path: up.uploads[0].path, name: 'brief.pdf' }] });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const { data } = await service.from('application_attachments').select('*').eq('application_id', id);
    expect(data).toMatchObject([{ file_name: 'brief.pdf', mime_type: 'application/pdf', size_bytes: pdfBytes.length }]);
  });

  it('rejects disallowed, oversized and disguised attachments', async () => {
    expect((await post('/api/uploads', { files: [{ name: 'run.exe', size: 10 }] })).status).toBe(422);
    expect((await post('/api/uploads', { files: [{ name: 'big.zip', size: 11 * 1024 * 1024 }] })).status).toBe(422);
    expect((await post('/api/uploads', { files: Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.pdf`, size: 10 })) })).status).toBe(422);

    // HTML disguised as a PDF: storage accepts the declared type, the server sniffs the bytes.
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const up = await (await post('/api/uploads', { files: [{ name: 'fake.pdf', size: html.length }] })).json();
    const fd = new FormData();
    fd.append('', new Blob([html], { type: 'application/pdf' }), 'fake.pdf');
    await fetch(up.uploads[0].signedUrl, { method: 'PUT', body: fd });
    const res = await submit({ uploadSession: up.session, attachments: [{ path: up.uploads[0].path, name: 'fake.pdf' }] });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/does not look like a valid/);

    // Storage itself refuses types outside the bucket allow-list.
    const up2 = await (await post('/api/uploads', { files: [{ name: 'x.pdf', size: 5 }] })).json();
    const fd2 = new FormData();
    fd2.append('', new Blob(['hello'], { type: 'text/html' }), 'x.pdf');
    expect((await fetch(up2.uploads[0].signedUrl, { method: 'PUT', body: fd2 })).ok).toBe(false);

    // A path from another upload session cannot be claimed.
    const res2 = await submit({ uploadSession: randomUUID(), attachments: [{ path: up.uploads[0].path, name: 'a.pdf' }] });
    expect(res2.status).toBe(422);
  });

  it('lets the client re-download their PDF only with the right token', async () => {
    const ok = await post('/api/applications/pdf', { reference: first.reference, token: first.accessToken });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
    const bad = await post('/api/applications/pdf', { reference: first.reference, token: 'x'.repeat(43) });
    expect(bad.status).toBe(404);
    const noRef = await post('/api/applications/pdf', { reference: 'INX-2026-ZZZZZZ', token: first.accessToken });
    expect(noRef.status).toBe(404);
  });

  it('regenerates a missing PDF on download', async () => {
    await service.from('applications').update({ pdf_path: null }).eq('id', first.id);
    const ok = await post('/api/applications/pdf', { reference: first.reference, token: first.accessToken });
    expect(ok.status).toBe(200);
    const { data } = await service.from('applications').select('pdf_path').eq('id', first.id).single();
    expect(data!.pdf_path).toBeTruthy();
  });

  it('keeps the submission when email delivery fails', async () => {
    await fetch('http://127.0.0.1:4599/fail-on', { method: 'POST' });
    try {
      const res = await submit({ form: { ...validForm, email: 'outage@example.com' } });
      expect(res.status).toBe(201);
      const { id } = await res.json();
      const { data: ev } = await service.from('email_events').select('status, error').eq('application_id', id);
      expect(ev!.every((e) => e.status === 'failed')).toBe(true);
      expect(ev![0].error).toContain('mock outage');
    } finally {
      await fetch('http://127.0.0.1:4599/fail-off', { method: 'POST' });
    }
  });
});

describe.runIf(process.env.INTEGRATION)('access control', () => {
  it('anonymous users cannot read or write any table', async () => {
    for (const t of ['applications', 'clients', 'application_notes', 'application_attachments', 'admin_users', 'email_events', 'application_status_history']) {
      const { data, error } = await anon.from(t).select('*').limit(1);
      expect(error ?? (data?.length === 0 ? 'empty' : null), t).toBeTruthy();
      expect(data ?? [], t).toHaveLength(0);
    }
    const { error } = await anon.from('applications').insert({ reference: 'INX-2026-AAAAAA' });
    expect(error).toBeTruthy();
    expect((await anon.rpc('admin_dashboard_stats')).error).toBeTruthy();
  });

  it('anonymous users cannot read private storage', async () => {
    const { data: row } = await service.from('applications').select('signature_path, pdf_path').limit(1).single();
    expect((await anon.storage.from('signatures').download(row!.signature_path)).error).toBeTruthy();
    expect((await anon.storage.from('documents').download(row!.pdf_path)).error).toBeTruthy();
    expect((await anon.storage.from('signatures').createSignedUrl(row!.signature_path, 60)).error).toBeTruthy();
    const pub = await fetch(`${SB_URL}/storage/v1/object/public/signatures/${row!.signature_path}`);
    expect(pub.ok).toBe(false);
  });

  it('signed-in non-admins see nothing and cannot use admin APIs', async () => {
    const { client, token } = await signIn('outsider@example.com', 'NotAdmin#2026');
    const { data } = await client.from('applications').select('id');
    expect(data).toEqual([]);
    expect((await client.rpc('admin_dashboard_stats')).error?.code).toBe('42501');
    const { data: row } = await service.from('applications').select('id').limit(1).single();
    expect((await client.rpc('set_application_status', { p_application_id: row!.id, p_status: 'approved' })).error).toBeTruthy();
    const res = await post('/api/admin/status', { applicationId: row!.id, status: 'approved' }, { authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    expect((await post('/api/admin/pdf', { applicationId: row!.id }, { authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await post('/api/admin/status', { applicationId: row!.id, status: 'approved' })).status).toBe(401);
  });

  it('admins can read, edit permitted fields, add notes and change status (logged)', async () => {
    const { client, token, userId } = await signIn('admin@innovexadigital.in', 'LocalAdmin#2026');
    const { data: rows } = await client.from('applications').select('id, status').eq('email', 'priya@example.com').limit(1);
    const id = rows![0].id;

    expect((await client.rpc('admin_dashboard_stats')).data.total_submissions).toBeGreaterThan(0);
    expect((await client.from('applications').update({ location: 'Coimbatore' }).eq('id', id)).error).toBeNull();
    // status and signed content are not directly editable
    expect((await client.from('applications').update({ status: 'approved' }).eq('id', id)).error).toBeTruthy();
    expect((await client.from('applications').update({ project_requirements: 'changed' }).eq('id', id)).error).toBeTruthy();
    expect((await client.from('applications').update({ email: 'x@y.com' }).eq('id', id)).error).toBeTruthy();
    // notes must be authored as yourself
    expect((await client.from('application_notes').insert({ application_id: id, body: 'Called client', author_id: userId })).error).toBeNull();
    expect((await client.from('application_notes').insert({ application_id: id, body: 'spoof', author_id: randomUUID() })).error).toBeTruthy();

    const res = await post('/api/admin/status', { applicationId: id, status: 'proposal_sent', note: 'Sent v1 proposal', notifyClient: true, clientMessage: 'Proposal attached in a separate email.' }, { authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe('sent');
    const { data: hist } = await client.from('application_status_history').select('*').eq('application_id', id).order('created_at', { ascending: false });
    expect(hist![0]).toMatchObject({ from_status: 'submitted', to_status: 'proposal_sent', changed_by: userId, note: 'Sent v1 proposal' });
    const mail = emails().find((e) => e.subject?.includes('Proposal sent'));
    expect(mail.html).toContain('Proposal attached in a separate email.');
    expect(mail.html).not.toContain('Sent v1 proposal'); // internal note never reaches the client

    // admins can open private files through short-lived signed URLs
    const { data: app } = await client.from('applications').select('signature_path').eq('id', id).single();
    const { data: signed } = await client.storage.from('signatures').createSignedUrl(app!.signature_path, 60);
    expect((await fetch(signed!.signedUrl)).ok).toBe(true);
    const pdf = await post('/api/admin/pdf', { applicationId: id }, { authorization: `Bearer ${token}` });
    expect(pdf.status).toBe(200);
  });

  it('deactivated admins lose access immediately', async () => {
    const { client } = await signIn('member@innovexadigital.in', 'LocalMember#2026');
    expect(((await client.from('applications').select('id')).data ?? []).length).toBeGreaterThan(0);
    await service.from('admin_users').update({ active: false }).eq('email', 'member@innovexadigital.in');
    try {
      expect((await client.from('applications').select('id')).data).toEqual([]);
    } finally {
      await service.from('admin_users').update({ active: true }).eq('email', 'member@innovexadigital.in');
    }
  });
});
