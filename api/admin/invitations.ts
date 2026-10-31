import { HttpError, handler, json, readJson } from '../../server/http.js';
import { createInvitation } from '../../server/invitations.js';
import { requireAdmin } from '../../server/supabase.js';

// POST /api/admin/invitations — email a client a personal onboarding link.
export const POST = handler(async (request) => {
  const admin = await requireAdmin(request);
  if (!admin) throw new HttpError(401, 'Not authorised.');
  return json(await createInvitation(await readJson(request, 8 * 1024), admin.userId), 201);
});
