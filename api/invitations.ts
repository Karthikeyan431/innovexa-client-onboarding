import { handler, json } from '../server/http.js';
import { lookupInvitation } from '../server/invitations.js';

// GET /api/invitations?token=… — prefill details for a personal onboarding link.
export const GET = handler(async (request) => {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const invitation = await lookupInvitation(token);
  if (!invitation) return json({ error: 'This invitation link is invalid or has expired.' }, 404);
  return json(invitation);
});
