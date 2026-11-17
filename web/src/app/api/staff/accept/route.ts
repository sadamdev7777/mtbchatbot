import { json } from "@/lib/api";
import { homeFor, type Role } from "@/lib/roles";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

/** Called after an invited user set their password: activates the member row. */
export async function POST() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  if (!data?.claims?.sub) return json({ error: "Not signed in" }, 401);
  const admin = supabaseAdmin();
  const { data: m } = await admin.from("members").update({ status: "active" }).eq("user_id", data.claims.sub).eq("status", "invited").select("role").maybeSingle();
  const { data: cur } = await admin.from("members").select("role, status").eq("user_id", data.claims.sub).maybeSingle();
  if (!cur || cur.status !== "active") return json({ error: "No invite found" }, 404);
  return json({ ok: true, home: homeFor((m?.role ?? cur.role) as Role), needs_2fa: ["owner", "admin"].includes(cur.role) });
}
