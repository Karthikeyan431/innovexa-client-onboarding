import { HttpError, handler, json, readJson } from '../../../server/http.js';
import { resendInvitation } from '../../../server/invitations.js';
import { requireAdmin } from '../../../server/supabase.js';

// POST /api/admin/invitations/resend — new link, extended expiry, email again.
export const POST = handler(async (request) => {
  const admin = await requireAdmin(request);
  if (!admin) throw new HttpError(401, 'Not authorised.');
  const body = await readJson(request, 2 * 1024);
  return json(await resendInvitation(body.invitationId, admin.userId));
});
