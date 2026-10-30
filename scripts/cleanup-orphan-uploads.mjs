// Removes attachment uploads that were never linked to a submitted application
// (e.g. the visitor abandoned the form after uploading). Safe to run on a schedule.
// Usage: node --env-file=.env.local scripts/cleanup-orphan-uploads.mjs [--dry-run] [--hours=24]
import { createClient } from '@supabase/supabase-js';

const dry = process.argv.includes('--dry-run');
const hours = Number(process.argv.find((a) => a.startsWith('--hours='))?.split('=')[1] ?? 24);
const db = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const storage = db.storage.from('attachments');
const cutoff = Date.now() - hours * 3600_000;

const { data: sessions, error } = await storage.list('uploads', { limit: 1000 });
if (error) throw error;
let removed = 0;
for (const s of sessions ?? []) {
  const { data: files } = await storage.list(`uploads/${s.name}`, { limit: 100 });
  const old = (files ?? []).filter((f) => new Date(f.created_at).getTime() < cutoff).map((f) => `uploads/${s.name}/${f.name}`);
  if (!old.length) continue;
  const { data: linked } = await db.from('application_attachments').select('storage_path').in('storage_path', old);
  const keep = new Set((linked ?? []).map((l) => l.storage_path));
  const orphans = old.filter((p) => !keep.has(p));
  if (!orphans.length) continue;
  if (!dry) await storage.remove(orphans);
  removed += orphans.length;
  console.log(`${dry ? '[dry-run] ' : ''}removed ${orphans.length} file(s) from uploads/${s.name}`);
}
console.log(`${dry ? '[dry-run] ' : ''}done: ${removed} orphaned file(s)`);
