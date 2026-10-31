// Integration tests for onboarding invitations (same local stack as api.test.ts).
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { makePng, signatureInk, validForm } from '../helpers';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const SB_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const emails = () => (existsSync('test-results/emails.jsonl') ? readFileSync('test-results/emails.jsonl', 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
async function signIn(email: string, password: string) {
  const c = createClient(SB_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client: c, token: data.session!.access_token, userId: data.user!.id };
}
const tokenOf = (link: string) => new URL(link).searchParams.get('invite')!;

describe.runIf(process.env.INTEGRATION)('onboarding invitations', () => {
  it('members can send an invitation; the email carries a working personal link', async () => {
    const member = await signIn('member@innovexadigital.in', 'LocalMember#2026');
    const email = `invitee-${Date.now()}@example.com`;
    const res = await post('/api/admin/invitations', { fullName: 'Meena Iyer', email, companyName: 'Iyer Textiles', message: 'Lovely to meet you.\nHere is the form.' }, member.token);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.email).toBe('sent');
    expect(body.link).toMatch(/\/\?invite=[A-Za-z0-9_-]{40,}$/);
    expect(body.invitation).toMatchObject({ full_name: 'Meena Iyer', email, company_name: 'Iyer Textiles', email_status: 'sent', sent_by: member.userId });

    const mail = emails().find((e) => e.to?.[0] === email);
    expect(mail.subject).toBe('Meena, start your project with Innovexa Digital');
    expect(mail.html).toContain(body.link);
    expect(mail.html).toContain('Divya S'); // sender name
    expect(mail.html).toContain('Lovely to meet you.');
    expect(mail.text).toContain(body.link);

    // only the hash is stored
    const { data: row } = await service.from('onboarding_invitations').select('token_hash').eq('id', body.invitation.id).single();
    expect(row!.token_hash).not.toContain(tokenOf(body.link));

    const pre = await fetch(`${BASE}/api/invitations?token=${tokenOf(body.link)}`);
    expect(pre.status).toBe(200);
    expect(await pre.json()).toEqual({ fullName: 'Meena Iyer', email, companyName: 'Iyer Textiles', completed: false });
  });

  it('validates input and refuses anonymous or non-admin callers', async () => {
    const owner = await signIn('admin@innovexadigital.in', 'LocalAdmin#2026');
    const bad = await post('/api/admin/invitations', { fullName: 'A', email: 'nope' }, owner.token);
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).fieldErrors).sort()).toEqual(['email', 'fullName']);
    expect((await post('/api/admin/invitations', { fullName: 'Ann Lee', email: 'ann@example.com' })).status).toBe(401);
    const outsider = await signIn('outsider@example.com', 'NotAdmin#2026');
    expect((await post('/api/admin/invitations', { fullName: 'Ann Lee', email: 'ann@example.com' }, outsider.token)).status).toBe(401);
    expect((await createClient(SB_URL, ANON).from('onboarding_invitations').select('id')).data ?? []).toEqual([]);
    expect((await fetch(`${BASE}/api/invitations?token=${'x'.repeat(43)}`)).status).toBe(404);
    expect((await fetch(`${BASE}/api/invitations?token=bad`)).status).toBe(404);
  });

  it('a submission through the link marks the invitation completed and links the application', async () => {
    const owner = await signIn('admin@innovexadigital.in', 'LocalAdmin#2026');
    const email = `completes-${Date.now()}@example.com`;
    const { invitation, link } = await (await post('/api/admin/invitations', { fullName: 'Ravi Kumar', email }, owner.token)).json();
    const sig = `data:image/png;base64,${Buffer.from(makePng(400, 120, signatureInk)).toString('base64')}`;
    const sub = await post('/api/applications', { idempotencyKey: randomUUID(), inviteToken: tokenOf(link), signature: sig, attachments: [], form: { ...validForm, fullName: 'Ravi Kumar', email } });
    expect(sub.status).toBe(201);
    const { id } = await sub.json();
    const { data } = await owner.client.from('onboarding_invitations').select('application_id, completed_at').eq('id', invitation.id).single();
    expect(data!.application_id).toBe(id);
    expect(data!.completed_at).toBeTruthy();
    expect((await (await fetch(`${BASE}/api/invitations?token=${tokenOf(link)}`)).json()).completed).toBe(true);
    // completed invitations cannot be resent
    expect((await post('/api/admin/invitations/resend', { invitationId: invitation.id }, owner.token)).status).toBe(409);
  });

  it('resend issues a new link and disables the old one; admins can cancel', async () => {
    const owner = await signIn('admin@innovexadigital.in', 'LocalAdmin#2026');
    const { invitation, link } = await (await post('/api/admin/invitations', { fullName: 'Sara Thomas', email: `resend-${Date.now()}@example.com` }, owner.token)).json();
    const again = await post('/api/admin/invitations/resend', { invitationId: invitation.id }, owner.token);
    expect(again.status).toBe(200);
    const r = await again.json();
    expect(r.link).not.toBe(link);
    expect(r.invitation.send_count).toBe(2);
    expect((await fetch(`${BASE}/api/invitations?token=${tokenOf(link)}`)).status).toBe(404);
    expect((await fetch(`${BASE}/api/invitations?token=${tokenOf(r.link)}`)).status).toBe(200);

    expect((await owner.client.from('onboarding_invitations').delete().eq('id', invitation.id)).error).toBeNull();
    expect((await fetch(`${BASE}/api/invitations?token=${tokenOf(r.link)}`)).status).toBe(404);
  });
});
