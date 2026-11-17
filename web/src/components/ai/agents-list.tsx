"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Card } from "@/components/ui/misc";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AgentAvatar, AiFrame, MODE_LABEL, StatusPill } from "./common";

interface AgentRow { id: string; name: string; avatar_color: string; description: string | null; destination: string | null; status: string; mode: string; travelboost_product_ids: string[] }

export function AgentsList() {
  const me = useMe();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [counts, setCounts] = useState<Record<string, { close: number; after: number }>>({});
  const [routes, setRoutes] = useState<{ type: string; n: number }[]>([]);
  useEffect(() => {
    const sb = supabaseBrowser();
    sb.from("agents").select("id, name, avatar_color, description, destination, status, mode, travelboost_product_ids").order("name").then(({ data }) => setAgents((data ?? []) as AgentRow[]));
    sb.from("conversations").select("agent_id, stage").not("agent_id", "is", null).neq("status", "closed").then(({ data }) => {
      const c: Record<string, { close: number; after: number }> = {};
      for (const r of data ?? []) {
        c[r.agent_id] ??= { close: 0, after: 0 };
        if (["lead", "booking"].includes(r.stage)) c[r.agent_id].close++;
        if (["deposit", "full_payment"].includes(r.stage)) c[r.agent_id].after++;
      }
      setCounts(c);
    });
    sb.from("routing_rules").select("type").eq("enabled", true).then(({ data }) => {
      const m = new Map<string, number>();
      for (const r of data ?? []) m.set(r.type, (m.get(r.type) ?? 0) + 1);
      setRoutes([...m.entries()].map(([type, n]) => ({ type, n })));
    });
  }, []);

  return (
    <AiFrame title="AI Team" description="One agent looks after one package, from close sale to after-sales. Click to open everything it knows."
      actions={isAdmin(me.role) ? <Link href="/ai/new" className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white no-underline hover:text-white">Hire new agent</Link> : null}>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="font-semibold">Router</h2>
          <p className="text-sm text-muted">Sends every new chat to the right agent: {routes.map((r) => `${r.n} ${r.type}`).join(" · ") || "no rules"}</p>
        </div>
        <Link href="/ai/router" className="text-sm font-semibold">Edit Router rules</Link>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <Link key={a.id} href={`/ai/agents/${a.id}`} aria-label={`Open ${a.name}'s profile`} className="no-underline">
            <Card className="flex h-full flex-col gap-3 p-5 text-ink transition-shadow hover:shadow-md">
              <div className="flex items-center gap-3">
                <AgentAvatar name={a.name} colour={a.avatar_color} />
                <div className="min-w-0">
                  <p className="text-lg font-bold">{a.name}</p>
                  <p className="truncate text-sm text-muted">{a.destination ?? a.description}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusPill status={a.status} /><span className="rounded-full bg-chip px-2 py-0.5 font-semibold">{MODE_LABEL[a.mode]}</span>
              </div>
              <p className="text-sm text-muted">{counts[a.id]?.close ?? 0} close-sale chats · {counts[a.id]?.after ?? 0} after-sales</p>
            </Card>
          </Link>
        ))}
        {isAdmin(me.role) ? (
          <Link href="/ai/new" className="no-underline">
            <Card className="flex h-full flex-col items-center justify-center gap-1 border-dashed p-5 text-center text-ink">
              <p className="font-semibold">Agent for a new package</p>
              <p className="text-sm text-muted">Pick a TravelBoost product, upload the itinerary</p>
            </Card>
          </Link>
        ) : null}
      </div>
    </AiFrame>
  );
}
