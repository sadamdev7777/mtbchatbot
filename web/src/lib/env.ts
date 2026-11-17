// Public values are inlined at build time; server values are read lazily.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL ?? `${SUPABASE_URL}/functions/v1`;
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
export const SIMULATOR_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SIMULATOR === "true";

export function serverEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}
