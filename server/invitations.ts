import { INVITATION_DAYS, validateInvitation } from '../src/shared/schema.js';
import { newAccessToken, sha256 } from './crypto.js';
import { invitationEmail, sendEmail } from './email.js';
import { env } from './env.js';
import { HttpError, UUID_RE } from './http.js';
import { serviceClient } from './supabase.js';

const linkFor = (token: string) => `${env.appBaseUrl}/?invite=${token}`;

async function senderName(userId: string): Promise<string> {
  const { data } = await serviceClient().from('admin_users').select('full_name').eq('user_id', userId).maybeSingle();
  return data?.full_name ?? 'The Innovexa team';
}

async function deliver(id: string, token: string, userId: string) {
  const db = serviceClient();
  const { data: inv } = await db.from('onboarding_invitations').select('*').eq('id', id).single();
  const link = linkFor(token);
  const status = await sendEmail('client_invitation', null, invitationEmail({
    fullName: inv.full_name, email: inv.email, companyName: inv.company_name ?? '', message: inv.message ?? '',
    link, senderName: await senderName(userId), expiresAt: new Date(inv.expires_at),
  }));
  const { data: updated } = await db.from('onboarding_invitations')
    .update({ email_status: status, email_error: status === 'sent' ? null : status === 'skipped' ? 'Email is not configured' : 'Email provider rejected the message (see server logs)' })
    .eq('id', id).select('*').single();
  return { invitation: updated, link, email: status };
}

/** Creates an invitation and emails the personal onboarding link. */
export async function createInvitation(raw: Record<string, unknown>, userId: string) {
  const { data, errors } = validateInvitation(raw);
  if (Object.keys(errors).length) throw new HttpError(422, 'Please correct the highlighted fields.', { fieldErrors: errors });
  const token = newAccessToken();
  const { data: inv, error } = await serviceClient().from('onboarding_invitations').insert({
    token_hash: sha256(token),
    email: data.email,
    full_name: data.fullName,
    company_name: data.companyName || null,
    message: data.message || null,
    sent_by: userId,
    expires_at: new Date(Date.now() + INVITATION_DAYS * 86400_000).toISOString(),
  }).select('id').single();
  if (error || !inv) throw new Error(`invitation insert failed: ${error?.message}`);
  return deliver(inv.id, token, userId);
}

/** Issues a fresh link (the old one stops working), extends expiry and re-sends. */
export async function resendInvitation(id: unknown, userId: string) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new HttpError(422, 'Invalid invitation.');
  const db = serviceClient();
  const { data: inv } = await db.from('onboarding_invitations').select('id, send_count, completed_at').eq('id', id).maybeSingle();
  if (!inv) throw new HttpError(404, 'Invitation not found.');
  if (inv.completed_at) throw new HttpError(409, 'This client has already completed the onboarding form.');
  const token = newAccessToken();
  await db.from('onboarding_invitations').update({
    token_hash: sha256(token),
    send_count: inv.send_count + 1,
    last_sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + INVITATION_DAYS * 86400_000).toISOString(),
    email_status: 'pending',
  }).eq('id', id);
  return deliver(id, token, userId);
}

const TOKEN_RE = /^[A-Za-z0-9_-]{32,100}$/;

/** Public: the details used to prefill the form for a valid invitation link. */
export async function lookupInvitation(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const { data } = await serviceClient().from('onboarding_invitations')
    .select('full_name, email, company_name, expires_at, completed_at').eq('token_hash', sha256(token)).maybeSingle();
  if (!data || new Date(data.expires_at) < new Date()) return null;
  return { fullName: data.full_name, email: data.email, companyName: data.company_name ?? '', completed: !!data.completed_at };
}

/** Links a submitted application to its invitation. Never fails a submission. */
export async function markInvitationCompleted(token: unknown, applicationId: string) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return;
  try {
    await serviceClient().from('onboarding_invitations')
      .update({ application_id: applicationId, completed_at: new Date().toISOString() })
      .eq('token_hash', sha256(token)).is('completed_at', null).gt('expires_at', new Date().toISOString());
  } catch (err) {
    console.error('[invitations] could not mark invitation completed', err);
  }
}
