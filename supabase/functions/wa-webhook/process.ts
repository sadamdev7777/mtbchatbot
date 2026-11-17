import { isOptOut } from "../_shared/core/rules.ts";
import { db } from "../_shared/db.ts";
import { sendViaGateway } from "../_shared/functions.ts";
import { metaFor } from "../_shared/providers/meta.ts";
import { invokeFunction } from "../_shared/functions.ts";
import { background } from "../_shared/http.ts";

const STATUS_ORDER: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

export interface InboundResult { inserted: number; duplicates: number; statuses: number }

/** Process one verified Meta webhook payload. Idempotent: wa_message_id is unique. */
export async function processPayload(payload: any): Promise<InboundResult> {
  const result: InboundResult = { inserted: 0, duplicates: 0, statuses: 0 };
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;
      const { data: channel } = await db().from("channels").select("*").eq("phone_number_id", phoneNumberId).maybeSingle();
      if (!channel) {
        console.warn("webhook for unknown phone_number_id", phoneNumberId);
        continue;
      }
      const names = new Map<string, string>((value.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        const ok = await handleInbound(channel, m, names.get(m.from) ?? null);
        if (ok) result.inserted++;
        else result.duplicates++;
      }
      for (const s of value.statuses ?? []) {
        await handleStatus(s);
        result.statuses++;
      }
    }
  }
  return result;
}

function mapInbound(m: any): { type: string; body: string | null; mediaId: string | null; mime: string | null; filename: string | null; meta: Record<string, unknown> } {
  const meta: Record<string, unknown> = {};
  switch (m.type) {
    case "text":
      return { type: "text", body: m.text?.body ?? "", mediaId: null, mime: null, filename: null, meta };
    case "image": case "video": case "audio": case "document": case "sticker": {
      const media = m[m.type] ?? {};
      return { type: m.type, body: media.caption ?? null, mediaId: media.id ?? null, mime: media.mime_type ?? null, filename: media.filename ?? null, meta };
    }
    case "interactive": {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply ?? {};
      meta.button_id = r.id;
      return { type: "interactive", body: r.title ?? null, mediaId: null, mime: null, filename: null, meta };
    }
    case "button":
      meta.button_payload = m.button?.payload;
      return { type: "button", body: m.button?.text ?? null, mediaId: null, mime: null, filename: null, meta };
    case "reaction":
      meta.reacted_to = m.reaction?.message_id;
      return { type: "reaction", body: m.reaction?.emoji ?? "", mediaId: null, mime: null, filename: null, meta };
    case "location":
      meta.location = m.location;
      return { type: "location", body: m.location?.name ?? `📍 ${m.location?.latitude},${m.location?.longitude}`, mediaId: null, mime: null, filename: null, meta };
    default:
      return { type: "unsupported", body: `[${m.type}]`, mediaId: null, mime: null, filename: null, meta };
  }
}

async function handleInbound(channel: any, m: any, profileName: string | null): Promise<boolean> {
  const companyId = channel.company_id;
  // fast idempotency check (the unique index is the real guarantee)
  const { data: existing } = await db().from("messages").select("id").eq("wa_message_id", m.id).maybeSingle();
  if (existing) return false;

  // contact
  let { data: contact } = await db().from("contacts").select("*").eq("company_id", companyId).eq("wa_id", m.from).maybeSingle();
  if (!contact) {
    const ins = await db().from("contacts").insert({
      company_id: companyId, wa_id: m.from, name: profileName, opt_in: true, opt_in_at: new Date().toISOString(),
      opt_in_source: "whatsapp_inbound", source: m.referral ? "FB ad" : null,
    }).select("*").single();
    contact = ins.data ?? (await db().from("contacts").select("*").eq("company_id", companyId).eq("wa_id", m.from).single()).data;
  } else if (!contact.name && profileName) {
    await db().from("contacts").update({ name: profileName }).eq("id", contact.id);
  }

  // conversation (one per channel + contact)
  let { data: conv } = await db().from("conversations").select("*").eq("channel_id", channel.id).eq("contact_id", contact.id).maybeSingle();
  if (!conv) {
    const ins = await db().from("conversations").insert({
      company_id: companyId, channel_id: channel.id, contact_id: contact.id, referral: m.referral ?? null,
    }).select("*").single();
    conv = ins.data ?? (await db().from("conversations").select("*").eq("channel_id", channel.id).eq("contact_id", contact.id).single()).data;
  } else if (m.referral && !conv.referral) {
    await db().from("conversations").update({ referral: m.referral }).eq("id", conv.id);
  }

  const mapped = mapInbound(m);
  if (m.referral) mapped.meta.referral = m.referral;
  if (m.context?.id) mapped.meta.context_id = m.context.id;
  const ts = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
  const { data: msg, error } = await db().from("messages").insert({
    company_id: companyId, conversation_id: conv.id, direction: "in", sender_type: "customer",
    type: mapped.type, body: mapped.body, wa_message_id: m.id, status: "received",
    reply_to_wa_id: m.context?.id ?? null, media_mime: mapped.mime, media_filename: mapped.filename, meta: mapped.meta,
    created_at: ts > new Date().toISOString() ? new Date().toISOString() : ts,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return false; // duplicate delivery
    throw new Error(error.message);
  }

  // Source label from Click-to-WhatsApp ads
  if (m.referral) {
    const { data: label } = await db().from("labels").select("id").eq("company_id", companyId).eq("group", "source").eq("name", "FB ad").maybeSingle();
    if (label) await db().rpc("apply_label", { p_conv: conv.id, p_label: label.id, p_by_type: "system", p_member: null, p_agent: null, p_reason: m.referral.headline ?? "Click-to-WhatsApp ad", p_confirmed: true });
  }

  // Media → Storage
  if (mapped.mediaId) {
    try {
      const meta = await metaFor(companyId, channel);
      const file = await meta.downloadMedia(mapped.mediaId);
      if (file) {
        const ext = (file.mime.split("/")[1] ?? "bin").split(";")[0].replace("jpeg", "jpg");
        const path = `${companyId}/inbound/${msg.id}.${ext}`;
        await db().storage.from("media").upload(path, file.bytes, { contentType: file.mime, upsert: true });
        await db().from("messages").update({ media_path: path, media_mime: file.mime }).eq("id", msg.id);
      }
    } catch (e) {
      console.error("media download failed", e);
    }
  }

  // Rule 13: opt-out
  if (isOptOut(mapped.body)) {
    await db().from("contacts").update({ opted_out_at: new Date().toISOString() }).eq("id", contact.id);
    await db().rpc("add_system_event", { p_conv: conv.id, p_body: "Customer opted out of broadcasts and marketing templates", p_meta: { kind: "opt_out" } });
    await sendViaGateway({
      conversation_id: conv.id, kind: "text", sender_type: "system", purpose: "system",
      body: "Baik, kami tidak akan hantar mesej promosi lagi. Cik masih boleh chat dengan kami bila-bila masa.",
    });
    return true;
  }

  // Notify the staff member who holds the chat
  if (conv.holder_type === "staff" && conv.holder_member_id) {
    await db().rpc("notify_member", {
      p_member: conv.holder_member_id, p_event: "customer_replied", p_title: `${contact.name ?? contact.wa_id} replied`,
      p_body: (mapped.body ?? `[${mapped.type}]`).slice(0, 140), p_link: `/inbox?c=${conv.id}`,
    });
  }

  // Hand the turn to the AI orchestrator (it debounces and decides whether to act).
  if (conv.holder_type !== "staff") {
    await db().from("conversations").update({ ai_pending_since: new Date().toISOString() }).eq("id", conv.id);
    background(invokeFunction("ai-orchestrator", { action: "inbound", conversation_id: conv.id, message_id: msg.id }));
  }
  return true;
}

async function handleStatus(s: any): Promise<void> {
  const { data: msg } = await db().from("messages").select("id, status, conversation_id").eq("wa_message_id", s.id).maybeSingle();
  const at = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString();
  // broadcast recipient tracking
  if (["delivered", "read", "failed"].includes(s.status)) {
    const upd: Record<string, unknown> = { status: s.status };
    if (s.status === "failed") upd.error_text = `${s.errors?.[0]?.code ?? ""}: ${s.errors?.[0]?.title ?? ""}`;
    await db().from("broadcast_recipients").update(upd).eq("wa_message_id", s.id).not("status", "in", "(replied,read)");
  }
  if (!msg) return;
  if (s.status === "failed") {
    const err = s.errors?.[0] ?? {};
    const { markFailed } = await import("../wa-send/send.ts");
    await markFailed(msg.conversation_id, msg.id, String(err.code ?? "unknown"), err.title ?? err.message ?? "Failed");
    return;
  }
  if ((STATUS_ORDER[s.status] ?? -1) <= (STATUS_ORDER[msg.status] ?? -1)) return; // never go backwards
  const upd: Record<string, unknown> = { status: s.status };
  if (s.status === "delivered") upd.delivered_at = at;
  if (s.status === "read") upd.read_at = at;
  await db().from("messages").update(upd).eq("id", msg.id);
}
