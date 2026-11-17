"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Card, Toggle } from "@/components/ui/misc";
import { supabaseBrowser } from "@/lib/supabase/client";

const RULES: Record<string, { name: string; when: string; then: string }> = {
  round_robin: { name: "Round-robin within the team", when: "chat handed to a team (by an AI agent or the Router)", then: "assign to the online staff member with the fewest open chats" },
  leave: { name: "Staff on leave (HRBoost or manual)", when: "staff member has approved leave today", then: "remove from round-robin; move their open chats to others in the team" },
  out_of_hours: { name: "Outside office hours (destinations without an AI agent)", when: "message arrives outside office hours for a destination with no agent", then: "send the message below, set the Needs staff flag" },
  staff_reminder: { name: "Staff not replying reminder", when: "staff owns a chat and hasn't replied for N minutes during office hours", then: "notify that staff member, then the team lead" },
  auto_close: { name: "Close old chats", when: "no messages for N days and no Needs staff flag", then: "close the chat; reopen when the customer messages" },
};
const ORDER = ["round_robin", "leave", "out_of_hours", "staff_reminder", "auto_close"];

interface Rule { id: string; key: string; enabled: boolean; config: Record<string, any>; runs_count: number }

export function AutomationSettings() {
  const sb = supabaseBrowser();
  const [rules, setRules] = useState<Rule[]>([]);
  const load = useCallback(async () => {
    const { data } = await sb.from("automation_rules").select("*");
    setRules(((data ?? []) as Rule[]).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)));
  }, [sb]);
  useEffect(() => { load(); }, [load]);
  async function patch(r: Rule, p: Partial<Rule>) {
    await sb.from("automation_rules").update(p).eq("id", r.id);
    load();
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">&ldquo;If this, do that&rdquo; rules that run without staff. Routing chats to agents: <Link href="/ai?tab=router">Router</Link> · Customer follow-ups: Follow-up tab in the agent · Auto/Assist mode: agent profile.</p>
      {rules.map((r) => {
        const d = RULES[r.key];
        return (
          <Card key={r.id} className="flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{d.name}</p>
                <p className="mt-1 text-sm"><span className="mr-1 rounded bg-info-soft px-1.5 py-0.5 text-xs font-bold text-info">IF</span>{d.when}</p>
                <p className="mt-1 text-sm"><span className="mr-1 rounded bg-success-soft px-1.5 py-0.5 text-xs font-bold text-success">THEN</span>{d.then}</p>
                <p className="mt-1 text-xs text-muted">{r.enabled ? `${r.runs_count} runs` : "Off"}</p>
              </div>
              <Toggle checked={r.enabled} onChange={(v) => patch(r, { enabled: v })} label={`Turn on ${d.name}`} />
            </div>
            {r.key === "out_of_hours" ? <Field label="Auto message (Malay)" htmlFor="ooh"><Textarea id="ooh" defaultValue={r.config.message} onBlur={(e) => patch(r, { config: { ...r.config, message: e.target.value } })} /></Field> : null}
            {r.key === "staff_reminder" ? (
              <div className="grid max-w-md grid-cols-2 gap-3">
                <Field label="Remind staff after (min)" htmlFor="sr1"><Input id="sr1" type="number" defaultValue={r.config.minutes} onBlur={(e) => patch(r, { config: { ...r.config, minutes: Number(e.target.value) } })} /></Field>
                <Field label="Tell team lead after (min)" htmlFor="sr2"><Input id="sr2" type="number" defaultValue={r.config.lead_after_minutes} onBlur={(e) => patch(r, { config: { ...r.config, lead_after_minutes: Number(e.target.value) } })} /></Field>
              </div>
            ) : null}
            {r.key === "auto_close" ? <Field label="Days without messages" htmlFor="ac"><Input id="ac" type="number" className="max-w-32" defaultValue={r.config.days} onBlur={(e) => patch(r, { config: { ...r.config, days: Number(e.target.value) } })} /></Field> : null}
          </Card>
        );
      })}
    </div>
  );
}
