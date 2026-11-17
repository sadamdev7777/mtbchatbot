import { apiCaller, json } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/server";

const ROLES = ["owner", "admin", "team_lead", "staff", "accounts"];

/** Staff join only by invite. Owner may invite any role; admin may invite everything except owner/admin. */
export async function POST(req: Request) {
  const caller = await apiCaller(["owner", "admin"]);
  if (!caller) return json({ error: "Not allowed" }, 403);
  const body = (await req.json().catch(() => ({}))) as { email?: string; display_name?: string; role?: string; team_ids?: string[] };
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email" }, 400);
  if (!body.role || !ROLES.includes(body.role)) return json({ error: "Pick a role" }, 400);
  if (caller.me.role === "admin" && (body.role === "owner" || body.role === "admin")) return json({ error: "Only the owner can invite owners or admins" }, 403);

  const admin = supabaseAdmin();
  const origin = req.headers.get("origin") ?? process.env.APP_URL ?? "http://127.0.0.1:3000";
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/invite/accept` });
  if (error || !data.user) return json({ error: error?.message ?? "Invite failed" }, 400);
  const { data: member, error: mErr } = await admin.from("members").insert({
    company_id: caller.me.company_id,
    user_id: data.user.id,
    email,
    role: body.role,
    display_name: body.display_name?.trim() || email.split("@")[0],
    status: "invited",
  }).select("id").single();
  if (mErr) return json({ error: mErr.message }, 400);
  if (body.team_ids?.length) {
    await admin.from("team_members").insert(body.team_ids.map((t) => ({ company_id: caller.me.company_id, team_id: t, member_id: member.id })));
  }
  await admin.from("events").insert({ company_id: caller.me.company_id, actor_member_id: caller.me.member_id, action: "invite", entity: "members", entity_id: member.id, after: { email, role: body.role } });
  return json({ ok: true, member_id: member.id });
}
