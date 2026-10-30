// Creates (or re-activates) an Innovexa admin user.
// Usage: npm run admin:create -- <email> "<Full Name>" [owner|admin|member]
// Requires SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
// A one-time password is printed; ask the person to change it via "Forgot password?".
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const [email, fullName, role = 'admin'] = process.argv.slice(2);
if (!email || !fullName || !['owner', 'admin', 'member'].includes(role)) {
  console.error('Usage: npm run admin:create -- <email> "<Full Name>" [owner|admin|member]');
  process.exit(1);
}
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url');
let userId;
const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  if (!/already|registered|exists/i.test(error.message)) throw error;
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  userId = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  if (!userId) throw error;
  console.log('User already exists; granting admin access.');
} else {
  userId = created.user.id;
  console.log(`Created user ${email}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`Temporary password: ${password}`);
}
const { error: upsertError } = await db.from('admin_users').upsert({ user_id: userId, email, full_name: fullName, role, active: true });
if (upsertError) throw upsertError;
console.log(`${email} is now an active ${role}.`);
