import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

let service: SupabaseClient | undefined;

/** Service-role client: bypasses RLS. Use only after validating the request. */
export function serviceClient(): SupabaseClient {
  service ??= createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: noSession });
  return service;
}

/** Client acting as the signed-in user, so RLS and is_admin() apply. */
export function userClient(jwt: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: noSession,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

/** Resolves the bearer token to an active admin, or null. */
export async function requireAdmin(request: Request): Promise<{ client: SupabaseClient; userId: string } | null> {
  const jwt = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!jwt) return null;
  const client = userClient(jwt);
  const { data: user, error } = await client.auth.getUser(jwt);
  if (error || !user.user) return null;
  const { data: isAdmin } = await client.rpc('is_admin');
  return isAdmin === true ? { client, userId: user.user.id } : null;
}
