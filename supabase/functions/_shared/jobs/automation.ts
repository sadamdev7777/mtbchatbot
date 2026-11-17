import { isWithinOfficeHours, type OfficeHours } from "../core/time.ts";
import { db } from "../db.ts";

async function rules(companyId: string) {
  const { data } = await db().from("automation_rules").select("key, enabled, config").eq("company_id", companyId);
  return new Map((data ?? []).map((r) => [r.key, r]));
}

/** Staff not replying for 30 min in office hours: notify them, then the team lead. */
export async function runStaffReminders(now = new Date()) {
  let notified = 0;
  const { data: companies } = await db().from("companies").select("id, office_hours, timezone");
  for (const co of companies ?? []) {
    const r = (await rules(co.id)).get("staff_reminder");
    if (!r?.enabled || !isWithinOfficeHours(now, co.office_hours as OfficeHours, co.timezone)) continue;
    const mins = Number(r.config?.minutes ?? 30), leadMins = Number(r.config?.lead_after_minutes ?? 60);
    const cutoff = new Date(now.getTime() - mins * 60000).toISOString();
    const { data: convs } = await db().from("conversations")
      .select("id, holder_member_id, team_id, last_inbound_at, last_staff_reply_at, contact:contacts(name, wa_id)")
      .eq("company_id", co.id).eq("holder_type", "staff").neq("status", "closed").lt("last_inbound_at", cutoff);
    for (const c of convs ?? []) {
      if (c.last_staff_reply_at && c.last_staff_reply_at >= c.last_inbound_at) continue;
      const contact = c.contact as unknown as { name: string | null; wa_id: string };
      const who = contact?.name ?? contact?.wa_id;
      const key = `staff_reminder:${c.last_inbound_at}`;
      const { error } = await db().from("followup_jobs").insert({ company_id: co.id, conversation_id: c.id, kind: "staff_reminder", step_key: key, due_at: now.toISOString(), status: "done", result: "notified_staff" });
      if (!error) {
        await db().rpc("notify_member", { p_member: c.holder_member_id, p_event: "team_unanswered", p_title: `${who} is waiting for your reply`, p_body: `No reply for ${mins} minutes`, p_link: `/inbox?c=${c.id}` });
        await db().rpc("bump_automation", { p_company: co.id, p_key: "staff_reminder" });
        notified++;
      }
      if (Date.parse(c.last_inbound_at) < now.getTime() - leadMins * 60000 && c.team_id) {
        const { data: team } = await db().from("teams").select("lead_member_id").eq("id", c.team_id).single();
        if (team?.lead_member_id && team.lead_member_id !== c.holder_member_id) {
          const { error: e2 } = await db().from("followup_jobs").insert({ company_id: co.id, conversation_id: c.id, kind: "staff_reminder", step_key: `${key}:lead`, due_at: now.toISOString(), status: "done", result: "notified_lead" });
          if (!e2) {
            await db().rpc("notify_member", { p_member: team.lead_member_id, p_event: "team_unanswered", p_title: `Team chat unanswered: ${who}`, p_body: `No reply for ${leadMins} minutes`, p_link: `/inbox?c=${c.id}` });
            notified++;
          }
        }
      }
    }
  }
  return { notified };
}

/** Close chats quiet for N days without Needs staff (they reopen when the customer writes). */
export async function runAutoClose(now = new Date()) {
  let closed = 0;
  const { data: companies } = await db().from("companies").select("id");
  for (const co of companies ?? []) {
    const r = (await rules(co.id)).get("auto_close");
    if (!r?.enabled) continue;
    const days = Number(r.config?.days ?? 7);
    const { data } = await db().from("conversations").update({ status: "closed", closed_at: now.toISOString() })
      .eq("company_id", co.id).neq("status", "closed").eq("needs_staff", false)
      .lt("last_message_at", new Date(now.getTime() - days * 86400000).toISOString()).select("id");
    closed += data?.length ?? 0;
    if (data?.length) await db().rpc("bump_automation", { p_company: co.id, p_key: "auto_close" });
  }
  return { closed };
}

/** Staff on leave today: reassign their open chats within the team (round-robin skips them). */
export async function runLeave(now = new Date(), onLeaveFromHr: (companyId: string) => Promise<string[]> = () => Promise.resolve([])) {
  let moved = 0;
  const today = now.toISOString().slice(0, 10);
  const { data: companies } = await db().from("companies").select("id");
  for (const co of companies ?? []) {
    const r = (await rules(co.id)).get("leave");
    if (!r?.enabled) continue;
    // HRBoost (or another HR provider) marks leave for today
    const emails = await onLeaveFromHr(co.id);
    if (emails.length) {
      await db().from("members").update({ on_leave_until: today, leave_source: "hrboost" }).eq("company_id", co.id).in("email", emails);
    }
    const { data: away } = await db().from("members").select("id").eq("company_id", co.id).gte("on_leave_until", today);
    for (const m of away ?? []) {
      const { data: convs } = await db().from("conversations").select("id, team_id").eq("holder_member_id", m.id).eq("holder_type", "staff").neq("status", "closed");
      for (const c of convs ?? []) {
        if (!c.team_id) continue;
        await db().from("conversations").update({ holder_type: "none", holder_member_id: null }).eq("id", c.id);
        await db().rpc("add_system_event", { p_conv: c.id, p_body: "Owner is on leave today: reassigning", p_meta: { kind: "assign" } });
        await db().rpc("assign_round_robin", { p_conv: c.id, p_team: c.team_id });
        moved++;
      }
    }
    if (moved) await db().rpc("bump_automation", { p_company: co.id, p_key: "leave" });
  }
  return { moved };
}

/** HOT decays to WARM after 7 quiet days. */
export async function runTemperatureDecay(now = new Date()) {
  const { data: hot } = await db().from("conversation_labels").select("id, conversation_id, company_id, label:labels!inner(name, group), conversation:conversations!inner(last_inbound_at)")
    .eq("label.name", "HOT").eq("label.group", "temperature");
  let decayed = 0;
  for (const row of hot ?? []) {
    const conv = row.conversation as unknown as { last_inbound_at: string | null };
    if (!conv.last_inbound_at || now.getTime() - Date.parse(conv.last_inbound_at) < 7 * 86400000) continue;
    const { data: warm } = await db().from("labels").select("id").eq("company_id", row.company_id).eq("group", "temperature").eq("name", "WARM").single();
    if (warm) {
      await db().rpc("apply_label", { p_conv: row.conversation_id, p_label: warm.id, p_by_type: "system", p_member: null, p_agent: null, p_reason: "7 quiet days", p_confirmed: true });
      decayed++;
    }
  }
  return { decayed };
}
