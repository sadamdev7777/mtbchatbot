"use client";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/misc";
import { invalidateDirectory } from "@/lib/directory";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Label } from "@/lib/types";

const GROUPS = [
  { key: "temperature", name: "Temperature", rule: "One per chat · AI sets it, staff can change it · HOT drops to WARM after 7 quiet days" },
  { key: "source", name: "Source", rule: "Automatic · from Click-to-WhatsApp ads or TravelBoost booking history" },
  { key: "attention", name: "Attention", rule: "AI suggests, staff confirms" },
  { key: "custom", name: "Custom", rule: "Created by admins for anything else" },
] as const;

export function LabelSettings() {
  const me = useMe();
  const sb = supabaseBrowser();
  const [labels, setLabels] = useState<(Label & { description: string | null; last_used_at: string | null; created_at: string })[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [edit, setEdit] = useState<{ id?: string; group: string; name: string; colour: string; description: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const { data } = await sb.from("labels").select("*").order("name");
    setLabels((data ?? []) as never);
    const { data: cl } = await sb.from("conversation_labels").select("label_id, conversation:conversations!inner(status)").neq("conversation.status", "closed");
    const c: Record<string, number> = {};
    for (const r of cl ?? []) c[r.label_id] = (c[r.label_id] ?? 0) + 1;
    setCounts(c);
    setNow(Date.now());
    invalidateDirectory();
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!edit) return;
    const row = { company_id: me.company_id, group: edit.group, name: edit.name.trim(), colour: edit.colour, description: edit.description || null, single_per_chat: edit.group === "temperature" };
    const { error } = edit.id ? await sb.from("labels").update(row).eq("id", edit.id) : await sb.from("labels").insert(row);
    if (error) return setMsg(error.code === "23505" ? "That label already exists in this group." : error.message);
    setEdit(null);
    load();
  }
  async function remove(id: string) {
    if (!confirm("Delete this label? It is removed from every chat.")) return;
    await sb.from("labels").delete().eq("id", id);
    load();
  }

  const stale = labels.filter((l) => now > 0 && l.group === "custom" && now - Date.parse(l.last_used_at ?? l.created_at) > 60 * 86400000);
  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <h2 className="text-base font-semibold">Not labels (system fields)</h2>
        <p className="mt-1 text-sm text-muted">Stage, Chat status, Owner, Team and the Needs staff flag are managed by the system. They can&apos;t be added as labels, so no stale labels are left behind.</p>
      </Card>
      {stale.map((l) => (
        <div key={l.id} role="note" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn-ink">
          <span>Label &ldquo;{l.name}&rdquo; unused for 60 days. The night job suggests removing it.</span>
          <Button size="sm" variant="secondary" onClick={() => remove(l.id)}>Remove label</Button>
        </div>
      ))}
      {GROUPS.map((g) => (
        <Card key={g.key} className="overflow-x-auto">
          <CardHeader title={g.name} description={g.rule} action={<Button size="sm" variant="secondary" onClick={() => setEdit({ group: g.key, name: "", colour: "#475467", description: "" })}>+ Label in group</Button>} />
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="border-b border-line bg-panel text-xs font-semibold text-muted"><tr><th className="px-4 py-2.5">Label</th><th className="px-3 py-2.5">How it&apos;s set</th><th className="px-3 py-2.5">Active chats</th><th className="px-3 py-2.5" /></tr></thead>
            <tbody>
              {labels.filter((l) => l.group === g.key).map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5"><span className="rounded px-2 py-0.5 text-xs font-bold" style={{ background: `${l.colour}1A`, color: l.colour }}>{l.name}</span></td>
                  <td className="px-3 py-2.5 text-muted">{l.description ?? "–"}</td>
                  <td className="px-3 py-2.5">{counts[l.id] ?? 0}</td>
                  <td className="px-3 py-2.5"><Button size="sm" variant="ghost" onClick={() => setEdit({ id: l.id, group: l.group, name: l.name, colour: l.colour, description: l.description ?? "" })}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      {edit ? (
        <Dialog open onClose={() => setEdit(null)} title={edit.id ? "Edit label" : "New label"} footer={<Button onClick={save} disabled={!edit.name.trim()}>Save</Button>}>
          <div className="flex flex-col gap-3">
            <Field label="Name" htmlFor="lb-name"><Input id="lb-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="How it's set" htmlFor="lb-desc"><Input id="lb-desc" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Colour" htmlFor="lb-col"><Input id="lb-col" type="color" className="h-10 w-20 p-1" value={edit.colour} onChange={(e) => setEdit({ ...edit, colour: e.target.value })} /></Field>
            {msg ? <p role="alert" className="text-sm text-danger">{msg}</p> : null}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
