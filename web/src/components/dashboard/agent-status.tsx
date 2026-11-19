"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentAvatar, MODE_LABEL, StatusPill } from "@/components/ai/common";
import { Card, CardHeader } from "@/components/ui/misc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, timeAgo } from "@/lib/utils";

interface AgentStatus {
  id: string; name: string; avatar_color: string; subtitle: string | null;
  status: string; mode: string; now_mode: "auto" | "assist" | "off"; why: string;
  open_chats: number; needs_staff: number; replies_today: number; drafts_today: number; last_active: string | null;
}
interface Data { claude: string; cap_reached: boolean; agents: AgentStatus[] }

const NOW: Record<AgentStatus["now_mode"], { label: string; dot: string; text: string }> = {
  auto: { label: "Replying", dot: "bg-success", text: "text-success" },
  assist: { label: "Drafting", dot: "bg-warn", text: "text-warn-ink" },
  off: { label: "Off", dot: "bg-faint", text: "text-muted" },
};

/** What each AI agent is doing right now, refreshed every minute. */
export function AgentStatusCard() {
  const [d, setD] = useState<Data | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const load = () => supabaseBrowser().rpc("rpc_agent_status").then(({ data }) => { if (data) { setD(data as Data); setNow(Date.now()); } });
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!d) return null;
  const replying = d.agents.filter((a) => a.now_mode === "auto").length;
  return (
    <Card>
      <CardHeader title="AI agents" description={d.agents.length ? `${replying} of ${d.agents.length} replying to customers now` : undefined}
        action={<Link href="/ai" className="text-sm font-semibold">AI Team</Link>} />
      {d.claude !== "connected" ? <p role="status" className="mx-5 mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">Claude is not connected or its last test failed. Agents cannot write real replies until it works (Settings › Integrations).</p> : null}
      {d.cap_reached ? <p role="status" className="mx-5 mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">This month&apos;s Claude budget is used up. All agents are paused until next month or until the cap is raised.</p> : null}
      {d.agents.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No AI agents yet.</p> : (
        <ul className="divide-y divide-line">
          {d.agents.map((a) => {
            const n = NOW[a.now_mode];
            return (
              <li key={a.id}>
                <Link href={`/ai/agents/${a.id}`} aria-label={`Open ${a.name}'s profile`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm text-ink no-underline hover:bg-chip/40">
                  <AgentAvatar name={a.name} colour={a.avatar_color} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2"><strong>{a.name}</strong><StatusPill status={a.status} /><span className="rounded-full bg-chip px-2 py-0.5 text-xs font-semibold">{MODE_LABEL[a.mode]}</span></span>
                    <span className="block truncate text-muted">{[a.subtitle, a.last_active ? `last reply ${timeAgo(a.last_active, now)}` : "no replies yet"].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="w-full text-left sm:w-56 sm:text-right">
                    <span className={cn("inline-flex items-center gap-1.5 font-semibold", n.text)}><span aria-hidden className={cn("h-2 w-2 rounded-full", n.dot)} />{n.label}</span>
                    <span className="block text-xs text-muted">{a.why}</span>
                  </span>
                  <span className="grid w-full grid-cols-4 gap-2 text-center text-xs text-muted sm:w-auto sm:min-w-[260px]">
                    <span><strong className="block text-base text-ink">{a.open_chats}</strong>open</span>
                    <span><strong className={cn("block text-base", a.needs_staff ? "text-warn-ink" : "text-ink")}>{a.needs_staff}</strong>need staff</span>
                    <span><strong className="block text-base text-ink">{a.replies_today}</strong>replies today</span>
                    <span><strong className="block text-base text-ink">{a.drafts_today}</strong>drafts today</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
