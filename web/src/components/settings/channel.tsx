"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/misc";
import { CopyField } from "@/components/ui/copy-field";
import { FUNCTIONS_URL } from "@/lib/env";
import { supabaseBrowser } from "@/lib/supabase/client";

interface Channel { id: string; display_name: string; phone_display: string | null; waba_id: string | null; phone_number_id: string | null; quality_rating: string | null; messaging_tier: string | null; webhook_verify_token: string; status: string }

export function ChannelSettings() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [meta, setMeta] = useState<string>("");
  useEffect(() => {
    const sb = supabaseBrowser();
    sb.from("channels").select("*").then(({ data }) => setChannels((data ?? []) as Channel[]));
    sb.rpc("rpc_integration_flags").then(({ data }) => setMeta((data as Record<string, string>)?.meta_whatsapp ?? ""));
  }, []);
  const tone = (q: string | null) => (q === "GREEN" ? "text-success" : q === "YELLOW" ? "text-warn" : q === "RED" ? "text-danger" : "text-muted");
  return (
    <div className="flex flex-col gap-4">
      {meta !== "connected" ? (
        <p role="note" className="rounded-lg border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn-ink">
          Meta WhatsApp is not connected: no real messages are sent. Connect it in Settings › Integrations. Until then, use the <a href="/dev/simulator">WhatsApp simulator</a>.
        </p>
      ) : null}
      {channels.map((c) => (
        <Card key={c.id}>
          <CardHeader title={c.display_name} description={c.phone_display ?? undefined} />
          <div className="grid gap-4 p-5 text-sm md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p><span className="text-muted">Quality rating:</span> <strong className={tone(c.quality_rating)}>{c.quality_rating ?? "Unknown"}</strong></p>
              <p><span className="text-muted">Messaging limit:</span> <strong>{c.messaging_tier ?? "Unknown"}</strong></p>
              <p><span className="text-muted">WABA ID:</span> {c.waba_id ?? "–"}</p>
              <p><span className="text-muted">Phone number ID:</span> {c.phone_number_id ?? "–"}</p>
              <p className="text-xs text-muted">Quality is checked every 15 minutes; owners and admins are notified when it drops.</p>
            </div>
            <div className="flex flex-col gap-3">
              <CopyField label="Webhook URL (Meta › WhatsApp › Configuration)" value={`${FUNCTIONS_URL}/wa-webhook`} />
              <CopyField label="Verify token" value={c.webhook_verify_token} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
