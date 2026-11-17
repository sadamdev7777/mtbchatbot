import { json } from "@/lib/api";
import { sendMail } from "@/lib/mailer";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { hashCode, newCode } from "@/lib/twofa";

export async function POST() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || !claims.session_id) return json({ error: "Not signed in" }, 401);
  const admin = supabaseAdmin();
  const { data: member } = await admin.from("members").select("company_id, email, role, status").eq("user_id", claims.sub).maybeSingle();
  if (!member || member.status !== "active") return json({ error: "No access" }, 403);
  if (!["owner", "admin"].includes(member.role)) return json({ error: "2-step is not required for your role" }, 400);

  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await admin.from("mfa_codes").select("id", { count: "exact", head: true }).eq("user_id", claims.sub).gte("created_at", since);
  if ((count ?? 0) >= 5) return json({ error: "Too many codes requested. Try again in 15 minutes." }, 429);

  const code = newCode();
  await admin.from("mfa_codes").insert({
    company_id: member.company_id,
    user_id: claims.sub,
    session_id: claims.session_id,
    code_hash: hashCode(code, String(claims.session_id)),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  // Demo deployments (dummy data, no mailbox for the seeded @mtb.test users) show the code on screen.
  // Never set DEMO_MODE once real keys or real customers are connected.
  if (process.env.DEMO_MODE === "true") return json({ ok: true, email: member.email, demo_code: code });
  try {
    await sendMail(member.company_id, member.email, `MTB Inbox verification code: ${code}`,
      `Your MTB Inbox verification code is ${code}.\n\nIt expires in 10 minutes. If you did not try to log in, change your password.`);
  } catch (e) {
    console.error("2fa mail failed", e);
    return json({ error: "Could not send the email. Check Settings › Integrations › Outgoing email." }, 502);
  }
  return json({ ok: true, email: member.email.replace(/^(.).*(@.*)$/, "$1•••$2") });
}
