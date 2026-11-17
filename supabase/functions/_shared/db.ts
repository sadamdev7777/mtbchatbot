import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ANON_KEY, SERVICE_ROLE_KEY, SUPABASE_URL } from "./env.ts";

let admin: SupabaseClient | null = null;

/** Service-role client (bypasses RLS). Edge Functions only. */
export function db(): SupabaseClient {
  if (!admin) {
    admin = createClient(SUPABASE_URL(), SERVICE_ROLE_KEY(), { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}

/** Client acting as the calling user (RLS + 2-step rules apply). */
export function userDb(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL(), ANON_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

export async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  if (data === null) throw new Error(`${what}: not found`);
  return data;
}
