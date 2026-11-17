"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Card } from "@/components/ui/misc";
import { toCsv, download } from "@/lib/csv";
import { useDirectory } from "@/lib/directory";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate, fmtTime } from "@/lib/utils";

interface Ev { id: string; actor_type: string; actor_member_id: string | null; action: string; entity: string; entity_id: string | null; before: any; after: any; created_at: string }

const ENTITY_LABEL: Record<string, string> = {
  conversations: "Chat", conversation_labels: "Label on chat", knowledge_docs: "Knowledge", members: "Staff", team_members: "Team membership",
  integrations: "Integration", agents: "AI agent", routing_rules: "Router rule", companies: "Company settings", automation_rules: "Automation", contacts: "Contact",
};

function describe(e: Ev, name: (id: string | null) => string): string {
  const a = e.after ?? {}, b = e.before ?? {};
  if (e.entity === "conversations") {
    const parts: string[] = [];
    if ("holder_type" in a || "holder_member_id" in a) parts.push(a.holder_type === "ai" ? "returned to bot" : a.holder_type === "staff" ? `taken by ${name(a.holder_member_id)}` : "holder cleared");
    if ("team_id" in a) parts.push("team changed");
    if ("stage" in a) parts.push(`stage ${b.stage} → ${a.stage}`);
    if ("status" in a) parts.push(`status ${a.status}`);
    if ("needs_staff" in a) parts.push(a.needs_staff ? "needs staff set" : "needs staff cleared");
    return parts.join(", ");
  }
  if (e.entity === "knowledge_docs") return `${a.section ?? b.section} v${a.version ?? b.version} ${a.status ?? ""}`;
  if (e.entity === "team_members") return e.action === "insert" ? `${name(a.member_id)} added to team` : `${name(b.member_id)} removed from team`;
  return Object.keys(a).length ? Object.entries(a).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 60) : v}`).join(", ") : e.action;
}

export function ActivityLog() {
  const dir = useDirectory();
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<Ev[]>([]);
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(0);
  const load = useCallback(async () => {
    let q = sb.from("events").select("*").order("created_at", { ascending: false }).range(page * 50, page * 50 + 49);
    if (entity) q = q.eq("entity", entity);
    const { data } = await q;
    setRows((data ?? []) as Ev[]);
  }, [sb, entity, page]);
  useEffect(() => { load(); }, [load]);
  const name = (id: string | null) => dir?.member(id)?.display_name ?? "someone";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select aria-label="Filter by type" className="max-w-60" value={entity} onChange={(e) => { setPage(0); setEntity(e.target.value); }}>
          <option value="">Everything</option>{Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Button variant="secondary" onClick={() => download("activity-log.csv", toCsv([["When", "Who", "Type", "Action", "Details"], ...rows.map((r) => [r.created_at, r.actor_type === "staff" ? name(r.actor_member_id) : r.actor_type, ENTITY_LABEL[r.entity] ?? r.entity, r.action, describe(r, name)])]))}>Export CSV</Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line bg-panel text-xs font-semibold text-muted"><tr><th className="px-4 py-3">When</th><th className="px-3 py-3">Who</th><th className="px-3 py-3">What</th><th className="px-3 py-3">Details</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-muted">{fmtDate(r.created_at)} {fmtTime(r.created_at)}</td>
                <td className="px-3 py-2.5">{r.actor_type === "staff" ? name(r.actor_member_id) : r.actor_type === "ai" ? "AI" : "System"}</td>
                <td className="px-3 py-2.5">{ENTITY_LABEL[r.entity] ?? r.entity} · {r.action}</td>
                <td className="px-3 py-2.5 text-muted">{describe(r, name)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</Button>
        <Button size="sm" variant="secondary" disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Older</Button>
      </div>
    </div>
  );
}
