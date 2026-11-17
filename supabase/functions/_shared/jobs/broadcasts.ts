import { isQuietHours, type QuietHours } from "../core/time.ts";
import { db } from "../db.ts";
import { sendViaGateway } from "../functions.ts";

export const BROADCAST_BATCH = Number(Deno.env.get("BROADCAST_BATCH_SIZE") ?? 50);

/** Sends due broadcasts in batches; waits during quiet hours (rule 12). */
export async function runBroadcasts(now = new Date()): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  const { data: due } = await db().from("broadcasts").select("*, company:companies(settings, timezone)")
    .or(`status.eq.sending,and(status.eq.scheduled,scheduled_at.lte.${now.toISOString()})`);
  for (const b of due ?? []) {
    const q = (b.company?.settings?.quiet_hours ?? undefined) as QuietHours | undefined;
    if (isQuietHours(now, q, b.company?.timezone)) continue;
    if (b.status === "scheduled") {
      await db().rpc("materialize_broadcast", { p_broadcast: b.id });
      const { data: fresh } = await db().from("broadcasts").update({ status: "sending", started_at: now.toISOString() }).eq("id", b.id).select("channel_id").single();
      b.channel_id = fresh?.channel_id ?? b.channel_id;
    }
    const { data: batch } = await db().from("broadcast_recipients")
      .select("id, contact_id, contact:contacts(name, opted_out_at, opt_in)").eq("broadcast_id", b.id).eq("status", "queued").limit(BROADCAST_BATCH);
    if (!batch?.length) {
      await db().from("broadcasts").update({ status: "sent", finished_at: now.toISOString() }).eq("id", b.id);
      continue;
    }
    for (const r of batch) {
      const contact = r.contact as unknown as { name: string | null; opted_out_at: string | null; opt_in: boolean };
      if (contact.opted_out_at || !contact.opt_in) {
        await db().from("broadcast_recipients").update({ status: "skipped", error_text: "opted out" }).eq("id", r.id);
        continue;
      }
      const { data: conv } = await db().from("conversations").select("id").eq("contact_id", r.contact_id).eq("channel_id", b.channel_id).single();
      const params = mapVariables(b.variable_mapping, contact);
      const res = await sendViaGateway({
        conversation_id: conv!.id, kind: "template", sender_type: "system", purpose: "broadcast", broadcast_recipient_id: r.id,
        template: { name: b.template_name, language: b.template_language, params },
      });
      if (res.data.ok) sent++;
      else {
        failed++;
        if (res.status !== 502) await db().from("broadcast_recipients").update({ status: "failed", error_text: res.data.message ?? res.data.error }).eq("id", r.id);
      }
    }
  }
  return { sent, failed };
}

/** variable_mapping: {"1": {"source":"contact.name","fallback":"Cik"}, "2": {"source":"static","value":"KK Kundasang"}} */
export function mapVariables(mapping: Record<string, { source: string; value?: string; fallback?: string }>, contact: { name: string | null }): string[] {
  const keys = Object.keys(mapping ?? {}).map(Number).sort((a, b) => a - b);
  return keys.map((k) => {
    const m = mapping[String(k)];
    if (m.source === "contact.name") return contact.name?.trim() || m.fallback || "Cik";
    return m.value ?? "";
  });
}
