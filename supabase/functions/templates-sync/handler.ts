// Syncs template status from Meta (every 15 min via pg_cron), submits new templates, checks number quality.
import { db } from "../_shared/db.ts";
import { getCaller, handle, HttpError, json, requireRole } from "../_shared/http.ts";
import { metaFor, type MetaTemplate } from "../_shared/providers/meta.ts";

async function companyChannel(companyId: string) {
  const { data } = await db().from("channels").select("*").eq("company_id", companyId).eq("status", "active").order("created_at").limit(1).maybeSingle();
  return data;
}

async function localTemplates(companyId: string): Promise<MetaTemplate[]> {
  const { data } = await db().from("templates").select("*").eq("company_id", companyId).neq("status", "DRAFT").neq("status", "SUGGESTED");
  return (data ?? []).map((t) => ({ id: t.meta_template_id, name: t.name, language: t.language, category: t.category, status: t.status, rejected_reason: t.rejection_reason, components: t.components }));
}

export async function syncCompany(companyId: string) {
  const channel = await companyChannel(companyId);
  if (!channel) return { synced: 0 };
  const meta = await metaFor(companyId, channel, () => localTemplates(companyId));
  const remote = await meta.listTemplates();
  let synced = 0;
  for (const t of remote) {
    const row = {
      company_id: companyId, name: t.name, language: t.language, category: t.category, status: t.status,
      rejection_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
      components: t.components, meta_template_id: t.id ?? null, last_synced_at: new Date().toISOString(),
    };
    const { error } = await db().from("templates").upsert(row, { onConflict: "company_id,name,language" });
    if (!error) synced++;
  }
  await db().rpc("recompute_template_usage", { p_company: companyId });
  // phone number quality
  const q = await meta.phoneQuality().catch(() => null);
  if (q) {
    const dropped = channel.quality_rating && rank(q.quality_rating) < rank(channel.quality_rating);
    await db().from("channels").update({ quality_rating: q.quality_rating, messaging_tier: q.messaging_limit_tier }).eq("id", channel.id);
    if (dropped) {
      const { data: admins } = await db().from("members").select("id").eq("company_id", companyId).in("role", ["owner", "admin"]).eq("status", "active");
      for (const a of admins ?? []) {
        await db().rpc("notify_member", { p_member: a.id, p_event: "message_failed", p_title: "WhatsApp number quality dropped", p_body: `${channel.quality_rating} → ${q.quality_rating}`, p_link: "/settings/channel" });
      }
    }
  }
  return { synced };
}

function rank(q: string): number {
  return ({ RED: 0, YELLOW: 1, GREEN: 2 } as Record<string, number>)[q] ?? 2;
}

export const handler = handle(async (req) => {
  const caller = await getCaller(req);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (body.action === "submit") {
    requireRole(caller, ["owner", "admin"]);
    const { data: t } = await db().from("templates").select("*").eq("id", body.template_id).maybeSingle();
    if (!t || (caller.kind === "user" && t.company_id !== caller.me.company_id)) throw new HttpError(404, "template_not_found");
    const channel = await companyChannel(t.company_id);
    if (!channel) throw new HttpError(400, "no_channel", "Connect a WhatsApp number first");
    const meta = await metaFor(t.company_id, channel);
    const r = await meta.createTemplate({ name: t.name, language: t.language, category: t.category, components: t.components });
    await db().from("templates").update({ status: r.status, meta_template_id: r.id, rejection_reason: null }).eq("id", t.id);
    return json({ ok: true, status: r.status });
  }
  // sync: one company (user) or all companies (cron)
  const companies = caller.kind === "user" ? [caller.me.company_id]
    : ((await db().from("companies").select("id")).data ?? []).map((c) => c.id);
  const results: Record<string, unknown> = {};
  for (const id of companies) results[id] = await syncCompany(id);
  return json({ ok: true, results });
});
