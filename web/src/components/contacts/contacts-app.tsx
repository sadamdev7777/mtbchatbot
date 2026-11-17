"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Card, Empty } from "@/components/ui/misc";
import { download, mapContactsCsv, toCsv, type ImportedContact } from "@/lib/csv";
import { useDirectory } from "@/lib/directory";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatPhone, STAGES, stageLabel } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

const PAGE = 25;

interface Row {
  id: string; wa_id: string; name: string | null; email: string | null; stage: string | null; destination: string | null;
  label_names: string[]; label_ids: string[]; owner_member_id: string | null; last_message_at: string | null; opt_in: boolean; opted_out_at: string | null; source: string | null;
}
interface Dup { keep_id: string; merge_id: string; name: string; email: string; keep_wa_id: string; merge_wa_id: string }

export function ContactsApp() {
  const me = useMe();
  const dir = useDirectory();
  const router = useRouter();
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [optedIn, setOptedIn] = useState(0);
  const [page, setPage] = useState(0);
  const [f, setF] = useState({ q: "", stage: "", dest: "", temp: "", source: "", owner: "" });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dups, setDups] = useState<Dup[]>([]);
  const [dialog, setDialog] = useState<"" | "import" | "add" | "merge" | "assign" | "label">("");
  const [destinations, setDestinations] = useState<string[]>([]);
  const canEdit = me.role !== "staff";

  const load = useCallback(async () => {
    let q = sb.from("contact_overview").select("id, wa_id, name, email, stage, destination, label_names, label_ids, owner_member_id, last_message_at, opt_in, opted_out_at, source", { count: "exact" })
      .order("last_message_at", { ascending: false, nullsFirst: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (f.q.trim()) {
      const s = f.q.trim().replace(/[%,()]/g, "");
      q = q.or(`name.ilike.%${s}%,wa_id.ilike.%${s.replace(/\D/g, "") || s}%,email.ilike.%${s}%`);
    }
    if (f.stage) q = q.eq("stage", f.stage);
    if (f.dest) q = q.eq("destination", f.dest);
    if (f.temp) q = q.contains("label_ids", [f.temp]);
    if (f.source) q = q.contains("label_ids", [f.source]);
    if (f.owner) q = q.eq("owner_member_id", f.owner);
    const { data, count } = await q;
    setRows((data ?? []) as Row[]);
    setTotal(count ?? 0);
    const { count: oi } = await sb.from("contacts").select("id", { count: "exact", head: true }).eq("opt_in", true).is("opted_out_at", null).is("merged_into_id", null);
    setOptedIn(oi ?? 0);
    const { data: d } = await sb.from("contact_duplicates").select("*").limit(50);
    setDups((d ?? []) as Dup[]);
  }, [sb, f, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    sb.from("contact_overview").select("destination").not("destination", "is", null).limit(1000).then(({ data }) => {
      setDestinations([...new Set((data ?? []).map((d) => d.destination as string))].sort());
    });
  }, [sb]);

  const pageRows = rows;
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => sel.has(r.id));

  async function exportCsv(onlySelected: boolean) {
    let data: Row[] = onlySelected ? rows.filter((r) => sel.has(r.id)) : [];
    if (!onlySelected) {
      const { data: all } = await sb.from("contact_overview").select("id, wa_id, name, email, stage, destination, label_names, label_ids, owner_member_id, last_message_at, opt_in, opted_out_at, source").limit(10000);
      data = (all ?? []) as Row[];
    }
    download(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([
      ["Name", "Phone", "Email", "Stage", "Destination", "Labels", "Owner", "Opt-in", "Opted out", "Last chat"],
      ...data.map((r) => [r.name, `+${r.wa_id}`, r.email, r.stage ? stageLabel(r.stage) : "", r.destination, r.label_names.join("; "),
        dir?.member(r.owner_member_id)?.display_name ?? "", r.opt_in ? "yes" : "no", r.opted_out_at ? "yes" : "no", r.last_message_at ? fmtDate(r.last_message_at) : ""]),
    ]));
  }

  if (!dir) return null;
  const temps = dir.labels.filter((l) => l.group === "temperature");
  const sources = dir.labels.filter((l) => l.group === "source");

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="mt-1 text-sm text-muted">{total.toLocaleString()} customers · {optedIn.toLocaleString()} agreed to receive messages (opt-in)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin(me.role) ? <Button variant="secondary" onClick={() => setDialog("import")}>Import CSV</Button> : null}
          <Button variant="secondary" onClick={() => exportCsv(false)}>Export</Button>
          {isAdmin(me.role) ? <Button onClick={() => setDialog("add")}>Add contact</Button> : null}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <div className="col-span-2">
          <label htmlFor="kq" className="sr-only">Search contacts</label>
          <Input id="kq" type="search" placeholder="Search name, number or email" value={f.q} onChange={(e) => { setPage(0); setF({ ...f, q: e.target.value }); }} />
        </div>
        <Select aria-label="Stage" value={f.stage} onChange={(e) => { setPage(0); setF({ ...f, stage: e.target.value }); }}>
          <option value="">All stages</option>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        <Select aria-label="Destination" value={f.dest} onChange={(e) => { setPage(0); setF({ ...f, dest: e.target.value }); }}>
          <option value="">All destinations</option>{destinations.map((d) => <option key={d}>{d}</option>)}
        </Select>
        <Select aria-label="Temperature" value={f.temp} onChange={(e) => { setPage(0); setF({ ...f, temp: e.target.value }); }}>
          <option value="">All temperatures</option>{temps.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Select aria-label="Source" value={f.source} onChange={(e) => { setPage(0); setF({ ...f, source: e.target.value }); }}>
          <option value="">All sources</option>{sources.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Select aria-label="Owner" value={f.owner} onChange={(e) => { setPage(0); setF({ ...f, owner: e.target.value }); }}>
          <option value="">All owners</option>{dir.members.filter((m) => m.role !== "accounts").map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </Select>
      </div>

      {dups.length && canEdit ? (
        <div role="note" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn-ink">
          <span><strong>{dups.length} contact pair{dups.length > 1 ? "s" : ""} may be the same person</strong> (same name and email, different numbers)</span>
          <Button size="sm" variant="secondary" onClick={() => setDialog("merge")}>Review and merge</Button>
        </div>
      ) : null}

      {sel.size ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand bg-brand-tint px-4 py-2 text-sm">
          <strong>{sel.size} selected</strong>
          {canEdit ? <Button size="sm" variant="secondary" onClick={() => setDialog("assign")}>Assign to…</Button> : null}
          {canEdit ? <Button size="sm" variant="secondary" onClick={() => setDialog("label")}>Add label</Button> : null}
          {me.role !== "staff" ? <Button size="sm" variant="secondary" onClick={() => {
            sessionStorage.setItem("broadcast_contacts", JSON.stringify([...sel]));
            router.push("/broadcast?new=1&from=contacts");
          }}>Add to broadcast</Button> : null}
          <Button size="sm" variant="secondary" onClick={() => exportCsv(true)}>Export</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Cancel</Button>
        </div>
      ) : null}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-line bg-panel text-xs font-semibold text-muted">
            <tr>
              <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage}
                onChange={() => { const s = new Set(sel); pageRows.forEach((r) => (allOnPage ? s.delete(r.id) : s.add(r.id))); setSel(s); }} /></th>
              <th className="px-3 py-3">Name</th><th className="px-3 py-3">Number</th><th className="px-3 py-3">Stage</th>
              <th className="px-3 py-3">Destination</th><th className="px-3 py-3">Labels</th><th className="px-3 py-3">Owner</th><th className="px-3 py-3">Last chat</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-panel">
                <td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${r.name ?? r.wa_id}`} checked={sel.has(r.id)}
                  onChange={() => { const s = new Set(sel); if (s.has(r.id)) s.delete(r.id); else s.add(r.id); setSel(s); }} /></td>
                <td className="px-3 py-3 font-semibold"><Link href={`/contacts/${r.id}`}>{r.name ?? "(no name)"}</Link>
                  {r.opted_out_at ? <span className="ml-2 rounded bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">Opted out</span> : null}</td>
                <td className="px-3 py-3 text-muted">{formatPhone(r.wa_id)}</td>
                <td className="px-3 py-3">{r.stage ? stageLabel(r.stage) : "–"}</td>
                <td className="px-3 py-3">{r.destination ?? "–"}</td>
                <td className="px-3 py-3">{r.label_names.join(", ") || "–"}</td>
                <td className="px-3 py-3">{dir.member(r.owner_member_id)?.display_name ?? "–"}</td>
                <td className="px-3 py-3 text-muted">{r.last_message_at ? fmtDate(r.last_message_at) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pageRows.length === 0 ? <Empty title="No contacts match these filters" /> : null}
      </Card>
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{total ? `${page * PAGE + 1}–${Math.min(total, (page + 1) * PAGE)} of ${total.toLocaleString()}` : "0"}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="secondary" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      <ImportDialog open={dialog === "import"} onClose={() => { setDialog(""); load(); }} />
      <AddDialog open={dialog === "add"} onClose={() => { setDialog(""); load(); }} />
      <MergeDialog open={dialog === "merge"} dups={dups} onClose={() => { setDialog(""); load(); }} />
      <BulkDialog open={dialog === "assign" || dialog === "label"} kind={dialog === "label" ? "label" : "assign"} ids={[...sel]}
        onClose={() => { setDialog(""); setSel(new Set()); load(); }} />
    </div>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const [parsed, setParsed] = useState<{ contacts: ImportedContact[]; skipped: { row: number; reason: string }[] } | null>(null);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setResult("");
    setParsed(mapContactsCsv(await file.text()));
  }
  async function run() {
    if (!parsed) return;
    setBusy(true);
    const sb = supabaseBrowser();
    let created = 0;
    for (let i = 0; i < parsed.contacts.length; i += 500) {
      const chunk = parsed.contacts.slice(i, i + 500).map((c) => ({
        company_id: me.company_id, wa_id: c.wa_id, name: c.name, email: c.email, state: c.state, opt_in: c.opt_in,
        opt_in_at: c.opt_in ? new Date().toISOString() : null, opt_in_source: c.opt_in ? "csv_import" : null, source: null,
        custom: c.labels.length ? { imported_labels: c.labels } : {},
      }));
      const { data, error } = await sb.from("contacts").upsert(chunk, { onConflict: "company_id,wa_id", ignoreDuplicates: true }).select("id");
      if (error) { setResult(`Error: ${error.message}`); setBusy(false); return; }
      created += data?.length ?? 0;
    }
    setResult(`Imported ${created} new contacts. ${parsed.contacts.length - created} already existed and were left unchanged. ${parsed.skipped.length} rows skipped.`);
    setBusy(false);
  }
  return (
    <Dialog open={open} onClose={() => { setParsed(null); setResult(""); onClose(); }} title="Import contacts from CSV"
      footer={<Button onClick={run} disabled={!parsed?.contacts.length || busy || !!result}>{busy ? "Importing…" : `Import ${parsed?.contacts.length ?? 0} contacts`}</Button>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">Works with a SleekFlow export or any CSV with a phone column (name, email, state, labels and an opt-in column are optional). Contacts without an opt-in column are imported as <strong>not opted in</strong> and won&apos;t get broadcasts.</p>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {parsed ? (
          <div className="rounded-lg bg-panel p-3">
            <p><strong>{parsed.contacts.length}</strong> contacts ready · <strong>{parsed.contacts.filter((c) => c.opt_in).length}</strong> opted in · <strong>{parsed.skipped.length}</strong> rows skipped</p>
            {parsed.skipped.slice(0, 5).map((s) => <p key={s.row} className="text-xs text-muted">Row {s.row}: {s.reason}</p>)}
          </div>
        ) : null}
        {result ? <p role="status" className="rounded-lg bg-success-soft p-3 text-success">{result}</p> : null}
      </div>
    </Dialog>
  );
}

function AddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const [v, setV] = useState({ name: "", phone: "", email: "", opt_in: false });
  const [error, setError] = useState("");
  async function save() {
    let wa = v.phone.replace(/\D/g, "");
    if (wa.startsWith("0")) wa = "6" + wa;
    if (!/^\d{8,15}$/.test(wa)) return setError("Enter a phone number with country code, e.g. 60123456789");
    const { error: e } = await supabaseBrowser().from("contacts").insert({
      company_id: me.company_id, wa_id: wa, name: v.name || null, email: v.email || null, opt_in: v.opt_in,
      opt_in_at: v.opt_in ? new Date().toISOString() : null, opt_in_source: v.opt_in ? "manual" : null,
    });
    if (e) return setError(e.code === "23505" ? "A contact with this number already exists." : e.message);
    setV({ name: "", phone: "", email: "", opt_in: false });
    onClose();
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add contact" footer={<Button onClick={save}>Save contact</Button>}>
      <div className="flex flex-col gap-3">
        <Field label="Name" htmlFor="ac-name"><Input id="ac-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="WhatsApp number" htmlFor="ac-phone"><Input id="ac-phone" placeholder="60123456789" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="Email" htmlFor="ac-email"><Input id="ac-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.opt_in} onChange={(e) => setV({ ...v, opt_in: e.target.checked })} /> Customer agreed to receive promotions (opt-in)</label>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}

function MergeDialog({ open, dups, onClose }: { open: boolean; dups: Dup[]; onClose: () => void }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  async function merge(d: Dup) {
    const { error: e } = await supabaseBrowser().rpc("rpc_merge_contacts", { p_keep: d.keep_id, p_merge: d.merge_id });
    if (e) return setError(e.message);
    setDone(new Set(done).add(d.merge_id));
  }
  return (
    <Dialog open={open} onClose={onClose} title="Review possible duplicates" wide>
      <ul className="flex flex-col gap-2">
        {dups.map((d) => (
          <li key={d.merge_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm">
            <span><strong>{d.name}</strong> · {d.email}<br /><span className="text-muted">Keep {formatPhone(d.keep_wa_id)} · merge {formatPhone(d.merge_wa_id)} into it</span></span>
            {done.has(d.merge_id) ? <span className="font-semibold text-success">Merged</span> : <Button size="sm" onClick={() => merge(d)}>Merge</Button>}
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </Dialog>
  );
}

function BulkDialog({ open, kind, ids, onClose }: { open: boolean; kind: "assign" | "label"; ids: string[]; onClose: () => void }) {
  const dir = useDirectory();
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState("");
  const options = useMemo(() => kind === "assign"
    ? (dir?.members ?? []).filter((m) => m.status === "active" && m.role !== "accounts").map((m) => ({ id: m.id, name: m.display_name }))
    : (dir?.labels ?? []).filter((l) => l.group !== "source").map((l) => ({ id: l.id, name: `${l.group} · ${l.name}` })), [dir, kind]);
  async function apply() {
    const sb = supabaseBrowser();
    const { data, error } = kind === "assign"
      ? await sb.rpc("rpc_bulk_set_owner", { p_contacts: ids, p_member: value })
      : await sb.rpc("rpc_bulk_label", { p_contacts: ids, p_label: value });
    setMsg(error ? error.message : kind === "assign" ? `Owner set on ${data} contacts.` : `Label added to ${data} chats.`);
  }
  return (
    <Dialog open={open} onClose={() => { setMsg(""); setValue(""); onClose(); }} title={kind === "assign" ? `Assign ${ids.length} contacts` : `Add label to ${ids.length} contacts`}
      footer={<Button onClick={apply} disabled={!value || !!msg}>Apply</Button>}>
      <Field label={kind === "assign" ? "Owner" : "Label"} htmlFor="bulk-v">
        <Select id="bulk-v" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Choose…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </Field>
      {msg ? <p role="status" className="mt-3 text-sm">{msg}</p> : null}
    </Dialog>
  );
}
