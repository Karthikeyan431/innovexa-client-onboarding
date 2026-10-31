import { HttpError, UUID_RE, handler, json, readJson } from '../../server/http.js';
import { requireAdmin, serviceClient } from '../../server/supabase.js';

// POST /api/admin/delete — permanently delete an application. The database
// function authorises the caller (owner/admin only), deletes the rows and logs
// the action; the stored files are then removed here.
export const POST = handler(async (request) => {
  const admin = await requireAdmin(request);
  if (!admin) throw new HttpError(401, 'Not authorised.');
  const body = await readJson(request, 2 * 1024);
  const id = String(body.applicationId ?? '');
  if (!UUID_RE.test(id)) throw new HttpError(422, 'Invalid application.');

  const { data: paths, error } = await admin.client.rpc('delete_application', { p_application_id: id });
  if (error) {
    if (error.code === '42501') throw new HttpError(403, 'Only owners and admins can delete applications.');
    if (error.code === 'P0002') throw new HttpError(404, 'Application not found.');
    throw new Error(`delete_application failed: ${error.message}`);
  }

  // Rows are gone at this point; a file that fails to delete is logged, not fatal.
  const storage = serviceClient().storage;
  const leftovers: string[] = [];
  for (const [bucket, list] of Object.entries((paths ?? {}) as Record<string, string[]>)) {
    if (!list.length) continue;
    const { error: rmError } = await storage.from(bucket).remove(list);
    if (rmError) {
      console.error(`[delete] could not remove files from ${bucket}`, rmError);
      leftovers.push(...list.map((p) => `${bucket}/${p}`));
    }
  }
  return json({ deleted: true, filesRemaining: leftovers.length });
});
