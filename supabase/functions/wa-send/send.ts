// The ONLY code path that calls Meta's send endpoint (rule 1). Enforces rules 2, 3, 10, 13.
import { isWindowOpen } from "../_shared/core/time.ts";
import { aiPrefix, staffPrefix, withPrefix } from "../_shared/core/rules.ts";
import { db, userDb } from "../_shared/db.ts";
import { type Caller, HttpError } from "../_shared/http.ts";
import { metaFor, type SendOutcome } from "../_shared/providers/meta.ts";
import type { SendRequest } from "../_shared/functions.ts";
import { checkSendRate } from "./rate.ts";

export interface GatewayResult { ok: boolean; message_id?: string; wa_message_id?: string; error?: string; message?: string }

const WINDOW_CLOSED_CODE = "131047";

async function staffName(conv: any): Promise<string> {
  // The conversation's owner (contact owner / holder) or the agent's default staff.
  const ids = [conv.holder_type === "staff" ? conv.holder_member_id : null, conv.contact?.owner_member_id, conv.agent?.default_staff_member_id].filter(Boolean);
  for (const id of ids) {
    const { data } = await db().from("members").select("display_name").eq("id", id).maybeSingle();
    if (data?.display_name) return data.display_name;
  }
  return "Muslimtravelbug";
}

export async function gatewaySend(input: SendRequest, caller: Caller): Promise<GatewayResult> {
  const { data: conv } = await db().from("conversations")
    .select("*, contact:contacts(*), channel:channels(*), agent:agents(id, name, default_staff_member_id)")
    .eq("id", input.conversation_id).maybeSingle();
  if (!conv) throw new HttpError(404, "conversation_not_found");

  // --- who is sending -------------------------------------------------------
  let senderMemberId: string | null = null;
  let prefix = "";
  if (caller.kind === "user") {
    if (input.sender_type !== "staff") throw new HttpError(403, "forbidden", "Users can only send as staff");
    if (caller.me.role === "accounts") throw new HttpError(403, "forbidden");
    const { data: visible } = await userDb(caller.jwt).rpc("can_see_conversation_id", { conv: conv.id });
    if (!visible) throw new HttpError(404, "conversation_not_found");
    senderMemberId = caller.me.member_id;
    // Rule 3: staff sending in an AI chat becomes the holder; another staff member's chat is locked.
    const { data: claim } = await db().rpc("staff_send_claim", { p_conv: conv.id, p_member: senderMemberId });
    if (claim === "held_by_other") throw new HttpError(409, "held_by_other", "Another staff member owns this chat. Take over first.");
    prefix = staffPrefix(caller.me.display_name);
  } else if (input.sender_type === "staff") {
    throw new HttpError(400, "bad_request", "Service callers cannot send as staff");
  } else if (input.sender_type === "ai") {
    prefix = aiPrefix(await staffName(conv));
  } else {
    prefix = "*Muslimtravelbug*";
  }

  const contact = conv.contact;
  // --- rule 2: 24-hour window -------------------------------------------------
  if (input.kind !== "template" && !isWindowOpen(conv.last_inbound_at)) {
    throw new HttpError(422, "window_closed", "The 24-hour window has closed. Only approved templates can be sent.");
  }

  // --- template checks + rule 13 opt-out ---------------------------------------
  let template: any = null;
  if (input.kind === "template") {
    if (!input.template?.name) throw new HttpError(400, "bad_request", "template.name required");
    const { data: t } = await db().from("templates").select("*").eq("company_id", conv.company_id)
      .eq("name", input.template.name).eq("language", input.template.language ?? "ms").maybeSingle();
    if (!t || t.status !== "APPROVED") throw new HttpError(422, "template_not_approved", `Template ${input.template.name} is not approved by Meta`);
    if (t.category === "MARKETING" && contact.opted_out_at) throw new HttpError(422, "opted_out", "Customer opted out of marketing messages");
    template = t;
  }
  if (input.purpose === "broadcast" && (contact.opted_out_at || !contact.opt_in)) {
    throw new HttpError(422, "opted_out", "Contact has not opted in or has opted out");
  }

  await checkSendRate(conv.channel_id);

  // --- compose + store (queued) ------------------------------------------------
  const isText = input.kind === "text";
  const body = isText ? withPrefix(prefix, input.body ?? "")
    : input.kind === "interactive" ? withPrefix(prefix, input.interactive?.body ?? "")
    : input.kind === "media" ? (input.media?.caption ? withPrefix(prefix, input.media.caption) : null)
    : renderTemplateBody(template, input.template?.params ?? []);
  if (isText && !(input.body ?? "").trim()) throw new HttpError(400, "bad_request", "Empty message");

  const mediaType = input.media ? mediaKind(input.media.mime) : null;
  const { data: msg, error: insErr } = await db().from("messages").insert({
    company_id: conv.company_id,
    conversation_id: conv.id,
    direction: "out",
    sender_type: input.sender_type,
    sender_member_id: senderMemberId,
    sender_agent_id: input.sender_type === "ai" ? (input.agent_id ?? conv.agent_id) : null,
    type: input.kind === "media" ? mediaType : input.kind,
    body,
    media_path: input.media?.path ?? null,
    media_mime: input.media?.mime ?? null,
    media_filename: input.media?.filename ?? null,
    template_name: template?.name ?? null,
    template_vars: input.kind === "template" ? { params: input.template?.params ?? [], header: input.template?.header_params ?? [] } : null,
    interactive: input.interactive ?? null,
    status: "queued",
    ai_run_id: input.ai_run_id ?? null,
    meta: { purpose: input.purpose ?? "reply", ...(input.meta ?? {}) },
  }).select("id").single();
  if (insErr) throw new Error(insErr.message);

  // --- call Meta -----------------------------------------------------------------
  const meta = await metaFor(conv.company_id, conv.channel);
  const to = contact.wa_id;
  let out: SendOutcome;
  if (input.kind === "text") out = await meta.sendText(to, body!);
  else if (input.kind === "template") out = await meta.sendTemplate(to, template.name, template.language, input.template?.params ?? [], input.template?.header_params ?? []);
  else if (input.kind === "interactive") out = await meta.sendInteractiveButtons(to, body!, input.interactive!.buttons);
  else {
    const { data: signed } = await db().storage.from("media").createSignedUrl(input.media!.path, 3600);
    out = await meta.sendMedia(to, mediaType as "image" | "document" | "audio" | "video", signed!.signedUrl, body ?? undefined, input.media!.filename);
  }

  if (out.ok) {
    await db().from("messages").update({ status: "sent", wa_message_id: out.waMessageId, sent_at: new Date().toISOString() }).eq("id", msg.id);
    if (input.kind === "template" && (input.purpose === "followup" || input.purpose === "aftersales")) {
      await db().from("conversations").update({ templates_sent: (conv.templates_sent ?? 0) + 1 }).eq("id", conv.id);
    }
    if (input.broadcast_recipient_id) {
      await db().from("broadcast_recipients").update({ status: "sent", wa_message_id: out.waMessageId, sent_at: new Date().toISOString() }).eq("id", input.broadcast_recipient_id);
    }
    return { ok: true, message_id: msg.id, wa_message_id: out.waMessageId };
  }
  await markFailed(conv.id, msg.id, out.code, out.message);
  if (input.broadcast_recipient_id) {
    await db().from("broadcast_recipients").update({ status: "failed", error_text: `${out.code}: ${out.message}` }).eq("id", input.broadcast_recipient_id);
  }
  return { ok: false, message_id: msg.id, error: out.code, message: out.message };
}

/** Failed send: store the reason, show red in the inbox; 131047 also flags Needs staff. */
export async function markFailed(conversationId: string, messageId: string, code: string, text: string) {
  await db().from("messages").update({ status: "failed", error_code: code, error_text: text }).eq("id", messageId);
  if (code === WINDOW_CLOSED_CODE) {
    await db().rpc("set_needs_staff", { p_conv: conversationId, p_reason: "Message failed: 24-hour window closed (131047). Send a template." });
  }
  const { data: c } = await db().from("conversations").select("holder_member_id, holder_type").eq("id", conversationId).single();
  if (c?.holder_type === "staff" && c.holder_member_id) {
    await db().rpc("notify_member", { p_member: c.holder_member_id, p_event: "message_failed", p_title: "A message failed to send", p_body: `${code}: ${text}`, p_link: `/inbox?c=${conversationId}` });
  }
}

export function renderTemplateBody(t: any, params: string[]): string {
  const comp = (t?.components ?? []).find((c: any) => c.type === "BODY");
  const text: string = comp?.text ?? t?.name ?? "";
  return text.replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}

export function mediaKind(mime: string): "image" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}
