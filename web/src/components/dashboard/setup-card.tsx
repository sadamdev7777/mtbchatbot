"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/misc";
import { INTEGRATIONS } from "@/lib/integrations-catalog";
import { supabaseBrowser } from "@/lib/supabase/client";

/** System setup progress: which integrations passed their connection test. */
export function SetupCard() {
  const [flags, setFlags] = useState<Record<string, string> | null>(null);
  useEffect(() => { supabaseBrowser().rpc("rpc_integration_flags").then(({ data }) => setFlags((data ?? {}) as Record<string, string>)); }, []);
  if (!flags) return null;
  const items = INTEGRATIONS.filter((i) => i.group !== "optional" || flags[i.key] === "connected");
  const done = items.filter((i) => flags[i.key] === "connected").length;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">System setup</p>
        <Link href="/settings/integrations" className="text-sm font-semibold">Integrations</Link>
      </div>
      <p className="mt-1 text-sm text-muted">{done} of {items.length} connected</p>
      <div className="mt-2 h-2 rounded-full bg-chip"><div className="h-2 rounded-full bg-brand" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></div>
      <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-2">
            <span aria-hidden className={flags[i.key] === "connected" ? "text-success" : flags[i.key] === "error" ? "text-danger" : "text-faint"}>{flags[i.key] === "connected" ? "●" : "○"}</span>
            {i.name}<span className="sr-only">: {flags[i.key] ?? "not connected"}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
