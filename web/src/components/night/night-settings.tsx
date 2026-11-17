"use client";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/misc";
import { callFunction } from "@/lib/functions";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate, fmtTime } from "@/lib/utils";

const SCHEDULE = [
  ["12:00 am", "audit", "Audit all bot chats of the day: price without a booking ask, unanswered questions, invented facts, wrong seat claims, failed messages"],
  ["1:00 am", "staff_style", "Scan staff chats; update the MTB language style with new patterns and evidence"],
  ["2:00 am", "deposit_compare", "Compare chats that reached a deposit vs those that didn't"],
  ["3:00 am", "proposals", "Propose official answers from real staff answers, rules and knowledge fixes"],
  ["4:00 am", "staff_audit", "Audit staff and leads: untouched needs-staff leads, thin teams, coaching notes"],
  ["5:00 am", "test_changes", "Run all test scenarios against the proposed changes; drop changes that fail"],
  ["6:00 am", "report", "Write the morning report; send it to the owner on WhatsApp"],
] as const;
const PERMS = [
  ["style", "Language style", ["apply", "suggest"]], ["official_answers", "Official answers", ["suggest", "apply"]], ["rules", "Rules", ["suggest", "apply"]],
  ["reassign", "Reassigning leads", ["suggest", "apply"]], ["coaching", "Coaching", ["team_lead", "off"]],
] as const;
const PERM_LABEL: Record<string, string> = { apply: "Apply directly", suggest: "Suggest first", team_lead: "Send to team lead", off: "Off" };

export function NightJobSettings() {
  const me = useMe();
  const sb = supabaseBrowser();
  const [settings, setSettings] = useState<any>(null);
  const [rep, setRep] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const { data } = await sb.from("companies").select("settings").single();
    setSettings(data?.settings ?? {});
    const { data: r } = await sb.from("night_reports").select("*").order("report_date", { ascending: false }).limit(1).maybeSingle();
    setRep(r);
  }, [sb]);
  useEffect(() => { load(); }, [load]);
  async function save(patch: Record<string, unknown>) {
    const next = { ...settings, ...patch };
    const { error } = await sb.from("companies").update({ settings: next }).eq("id", me.company_id);
    setMsg(error ? error.message : "Saved");
    load();
  }
  async function runNow() {
    setBusy(true);
    setMsg("Running all phases…");
    try { await callFunction("night-job", { action: "run_all" }); setMsg("Done. Open the morning report."); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
    load();
  }
  if (!settings) return null;
  const perms = settings.night_job_permissions ?? {};
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Every night 12:00 am – 6:00 am · Claude Opus reads all bot and staff chats, learns, and audits.{rep?.phases?.report?.ran_at ? ` Last report ${fmtDate(rep.phases.report.ran_at)} ${fmtTime(rep.phases.report.ran_at)}.` : ""}</p>
        {me.role === "owner" ? <Button variant="secondary" onClick={runNow} disabled={busy}>{busy ? "Running…" : "Run all phases now"}</Button> : null}
      </div>
      {msg ? <p role="status" className="text-sm">{msg}</p> : null}
      <Card>
        <CardHeader title="Schedule" description={rep ? `Last run: report for ${fmtDate(rep.report_date)}` : "Not run yet"} />
        <ol className="divide-y divide-line">
          {SCHEDULE.map(([t, key, title]) => {
            const r = rep?.phases?.[key];
            return (
              <li key={key} className="grid gap-1 px-5 py-3 text-sm md:grid-cols-[90px_1fr_220px]">
                <span className="font-semibold">{t}</span><span>{title}</span>
                <span className={r ? (r.ok ? "text-success" : "text-danger") : "text-muted"}>{r ? (r.ok ? `Done ${fmtTime(r.ran_at)}` : `Failed: ${r.error}`) : "–"}</span>
              </li>
            );
          })}
        </ol>
      </Card>
      <Card>
        <CardHeader title="What the night job may change on its own" description="Direct changes only happen after all bot tests pass. Everything can be rolled back in the version history." />
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {PERMS.map(([k, label, options]) => (
            <label key={k} className="flex items-center justify-between gap-3 text-sm"><span>{label}</span>
              <Select className="h-9 w-48" value={perms[k] ?? options[0]} disabled={!isAdmin(me.role)} onChange={(e) => save({ night_job_permissions: { ...perms, [k]: e.target.value } })}>
                {options.map((o) => <option key={o} value={o}>{PERM_LABEL[o]}</option>)}
              </Select></label>
          ))}
          <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2"><span>Send the 6:00 am morning report on WhatsApp to</span>
            <Input className="h-9 w-56" defaultValue={settings.owner_report_number ?? ""} disabled={!isAdmin(me.role)} onBlur={(e) => save({ owner_report_number: e.target.value.replace(/\D/g, "") })} /></label>
        </div>
      </Card>
    </div>
  );
}
