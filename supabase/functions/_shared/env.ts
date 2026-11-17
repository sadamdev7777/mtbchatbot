// Environment access for Edge Functions (Deno).
export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${name}`);
  return v;
}
export const SUPABASE_URL = () => env("SUPABASE_URL");
export const SERVICE_ROLE_KEY = () => env("SUPABASE_SERVICE_ROLE_KEY");
export const ANON_KEY = () => env("SUPABASE_ANON_KEY");
export const MOCK_PROVIDERS = () => (Deno.env.get("MOCK_PROVIDERS") ?? "false") === "true";
export const INTERNAL_KEY = () => Deno.env.get("INTERNAL_KEY") ?? "";
export const FUNCTIONS_PUBLIC_URL = () => Deno.env.get("FUNCTIONS_PUBLIC_URL") ?? `${SUPABASE_URL()}/functions/v1`;
export const META_GRAPH_VERSION = () => Deno.env.get("META_GRAPH_VERSION") ?? "v24.0";
/** Signing secret used by the dev simulator / mock Meta (never valid for a real app). */
export const MOCK_APP_SECRET = () => Deno.env.get("META_MOCK_APP_SECRET") ?? "mock-app-secret";
