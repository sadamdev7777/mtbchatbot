// Web Push delivery for notifications (VAPID). Honours per-event push prefs and personal quiet hours.
import webpush from "web-push";
import { isQuietHours } from "../_shared/core/time.ts";
import { db } from "../_shared/db.ts";
import { getCaller, handle, HttpError, json } from "../_shared/http.ts";
import { getIntegration, getSecret, useReal } from "../_shared/integrations.ts";

export async function pushNotification(notificationId: string, now = new Date()): Promise<{ status: string; sent: number }> {
  const { data: n } = await db().from("notifications").select("*, member:members(id, push_quiet_hours)").eq("id", notificationId).maybeSingle();
  if (!n || n.pushed_at) return { status: "skip", sent: 0 };
  const { data: pref } = await db().from("notification_prefs").select("push").eq("member_id", n.member_id).eq("event", n.event).maybeSingle();
  if (pref && !pref.push) return { status: "pref_off", sent: 0 };
  const quiet = n.member?.push_quiet_hours as { start: string; end: string } | null;
  if (quiet?.start && quiet?.end && isQuietHours(now, { start: quiet.start, end: quiet.end })) return { status: "personal_quiet_hours", sent: 0 };

  const { data: subs } = await db().from("push_subscriptions").select("*").eq("member_id", n.member_id);
  if (!subs?.length) return { status: "no_subscription", sent: 0 };
  const real = await useReal(n.company_id, "web_push");
  if (!real) {
    // Web Push not connected (or mock mode): browser sound only. Mark handled so sweeps don't retry.
    await db().from("notifications").update({ pushed_at: now.toISOString() }).eq("id", n.id);
    return { status: "mock", sent: subs.length };
  }
  const integ = await getIntegration(n.company_id, "web_push");
  const priv = await getSecret(n.company_id, "web_push", "private_key");
  webpush.setVapidDetails(integ.config.subject ?? "mailto:ops@muslimtravelbug.com", integ.config.public_key, priv!);
  const payload = JSON.stringify({ title: n.title, body: n.body ?? "", url: n.link ?? "/inbox", tag: n.event });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db().from("push_subscriptions").delete().eq("id", s.id);
      else console.error("push failed", code, (e as Error).message);
    }
  }
  await db().from("notifications").update({ pushed_at: now.toISOString() }).eq("id", n.id);
  return { status: "sent", sent };
}

export const handler = handle(async (req) => {
  const caller = await getCaller(req);
  if (caller.kind !== "service") throw new HttpError(403, "forbidden");
  const body = await req.json().catch(() => ({}));
  if (body.notification_id) return json({ ok: true, ...(await pushNotification(body.notification_id)) });
  // sweep: anything from the last 10 minutes not yet pushed (e.g. the trigger call failed)
  const { data } = await db().from("notifications").select("id").is("pushed_at", null).gt("created_at", new Date(Date.now() - 600_000).toISOString()).limit(200);
  let n = 0;
  for (const r of data ?? []) n += (await pushNotification(r.id)).sent;
  return json({ ok: true, swept: data?.length ?? 0, sent: n });
});
