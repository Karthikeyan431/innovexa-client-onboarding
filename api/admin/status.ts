import { STATUSES, type Status } from '../../src/shared/schema.js';
import { loadEmailApplication } from '../../server/applications.js';
import { NOTIFIABLE_STATUSES, sendEmail, statusUpdateEmail } from '../../server/email.js';
import { HttpError, UUID_RE, handler, json, readJson } from '../../server/http.js';
import { requireAdmin } from '../../server/supabase.js';

// POST /api/admin/status — change an application's status (authorised and
// logged by the database), optionally emailing the client.
export const POST = handler(async (request) => {
  const admin = await requireAdmin(request);
  if (!admin) throw new HttpError(401, 'Not authorised.');
  const body = await readJson(request, 8 * 1024);

  const applicationId = String(body.applicationId ?? '');
  const status = String(body.status ?? '') as Status;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  const clientMessage = typeof body.clientMessage === 'string' ? body.clientMessage.trim().slice(0, 2000) : '';
  if (!UUID_RE.test(applicationId) || !STATUSES.includes(status) || status === 'draft') throw new HttpError(422, 'Invalid status change.');

  const { data, error } = await admin.client.rpc('set_application_status', {
    p_application_id: applicationId, p_status: status, p_note: note || null,
  });
  if (error) {
    if (error.code === '42501') throw new HttpError(403, 'Not authorised.');
    if (error.code === 'P0002') throw new HttpError(404, 'Application not found.');
    throw new Error(`set_application_status failed: ${error.message}`);
  }

  let email: string = 'not_requested';
  if (body.notifyClient === true && NOTIFIABLE_STATUSES.includes(status)) {
    const app = await loadEmailApplication(applicationId);
    email = await sendEmail('client_status_update', applicationId, statusUpdateEmail(app, status, clientMessage || undefined));
  }
  return json({ application: data, email });
});
