export type Stage = "lead" | "booking" | "deposit" | "full_payment" | "trip_done" | "lost";
export const STAGES: { key: Stage; label: string }[] = [
  { key: "lead", label: "Lead" }, { key: "booking", label: "Booking" }, { key: "deposit", label: "Deposit" },
  { key: "full_payment", label: "Full payment" }, { key: "trip_done", label: "Trip done" }, { key: "lost", label: "Lost" },
];
export const stageLabel = (s: string) => STAGES.find((x) => x.key === s)?.label ?? s;

export interface Contact {
  id: string; wa_id: string; name: string | null; email: string | null; state: string | null; opt_in: boolean;
  opted_out_at: string | null; owner_member_id: string | null; travelboost_customer_id: string | null; source: string | null;
  passport_status: unknown; custom: Record<string, unknown>; created_at: string; opt_in_at: string | null; opt_in_source: string | null;
}

export interface Conversation {
  id: string; company_id: string; channel_id: string; contact_id: string; status: "open" | "waiting_customer" | "closed";
  team_id: string | null; agent_id: string | null; holder_type: "ai" | "staff" | "none"; holder_member_id: string | null;
  needs_staff: boolean; needs_staff_reason: string | null; needs_staff_since: string | null; stage: Stage;
  last_inbound_at: string | null; last_message_at: string | null; last_message_preview: string | null;
  staff_typing_until: string | null; ai_summary: string | null; key_details: { destination?: string; pax?: number | string; adults?: number; children?: number };
  referral: { headline?: string; source_id?: string } | null; booking_ref: string | null; trip_date: string | null; created_at: string;
  contact?: Contact;
}

export interface Message {
  id: string; conversation_id: string; direction: "in" | "out"; sender_type: "customer" | "staff" | "ai" | "system";
  sender_member_id: string | null; sender_agent_id: string | null; type: string; body: string | null; media_path: string | null;
  media_mime: string | null; media_filename: string | null; template_name: string | null; status: string; error_code: string | null;
  error_text: string | null; is_internal_note: boolean; meta: Record<string, any>; created_at: string; ai_run_id: string | null;
  wa_message_id: string | null; interactive: { body: string; buttons: { id: string; title: string }[] } | null;
}

export interface Member { id: string; display_name: string; role: string; status: string; avatar_color: string; last_seen_at: string | null; on_leave_until: string | null; email: string }
export interface Team { id: string; name: string; is_general: boolean; lead_member_id: string | null }
export interface Agent { id: string; name: string; avatar_color: string; description: string | null; team_id: string | null; mode: string; status: string; default_staff_member_id: string | null }
export interface Label { id: string; group: "temperature" | "source" | "attention" | "custom"; name: string; colour: string; single_per_chat: boolean }
export interface ConversationLabel { id: string; conversation_id: string; label_id: string; set_by_type: string; set_by_member_id: string | null; set_by_agent_id: string | null; reason: string | null; confirmed: boolean }
export interface Template { id: string; name: string; category: string; language: string; status: string; rejection_reason: string | null; components: any[]; used_by: string[]; meta_template_id: string | null; last_synced_at: string | null }
export interface Draft { id: string; conversation_id: string; agent_id: string | null; body: string; seat_data: any; status: string; created_at: string }
export interface QuickReply { id: string; shortcut: string; body: string }

export function templateBody(t: Pick<Template, "components">): string {
  return (t.components ?? []).find((c: any) => c.type === "BODY")?.text ?? "";
}
export function templateVarCount(t: Pick<Template, "components">): number {
  const m = templateBody(t).match(/\{\{(\d+)\}\}/g) ?? [];
  return m.reduce((mx, s) => Math.max(mx, Number(s.replace(/\D/g, ""))), 0);
}

/** Strip the "*Name*" identity prefix line WhatsApp shows; the inbox shows the sender separately. */
export function stripPrefix(body: string | null): string {
  if (!body) return "";
  return body.replace(/^\*[^*\n]+\*\n/, "");
}

export function maskPhone(wa: string): string {
  if (wa.length < 8) return wa;
  return `+${wa.slice(0, 2)} ${wa.slice(2, 4)}-*** ${wa.slice(-4)}`;
}
export function formatPhone(wa: string): string {
  return `+${wa.slice(0, 2)} ${wa.slice(2, 4)}-${wa.slice(4, 7)} ${wa.slice(7)}`;
}
