import { json } from "@/lib/api";
import { homeFor, type Role } from "@/lib/roles";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { hashCode, sameHash } from "@/lib/twofa";

export async function POST(req: Request) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || !claims.session_id) return json({ error: "Not signed in" }, 401);
  if (!code || !/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code." }, 400);
  const admin = supabaseAdmin();
  const { data: row } = await admin.from("mfa_codes").select("id, code_hash, attempts, expires_at")
    .eq("user_id", claims.sub).eq("session_id", claims.session_id).is("verified_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!row || Date.parse(row.expires_at) < Date.now()) return json({ error: "The code expired. Send a new one." }, 400);
  if (row.attempts >= 5) return json({ error: "Too many attempts. Send a new code." }, 429);
  if (!sameHash(row.code_hash, hashCode(code, String(claims.session_id)))) {
    await admin.from("mfa_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return json({ error: "Wrong code." }, 400);
  }
  await admin.from("mfa_codes").update({ verified_at: new Date().toISOString() }).eq("id", row.id);
  const { data: member } = await admin.from("members").select("role").eq("user_id", claims.sub).single();
  return json({ ok: true, home: homeFor(member!.role as Role) });
}
