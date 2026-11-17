"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { Field, Input } from "@/components/ui/input";
import { Badge, Card } from "@/components/ui/misc";
import { FUNCTIONS_URL } from "@/lib/env";
import { callFunction } from "@/lib/functions";
import { GROUP_LABEL, INTEGRATIONS, type IntegrationDef } from "@/lib/integrations-catalog";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate, fmtTime } from "@/lib/utils";

interface Row { key: string; status: "not_connected" | "connected" | "error"; config: Record<string, any>; secret_refs: Record<string, { last4: string; updated_at: string }>; last_test_at: string | null; last_test_result: { ok: boolean; message: string } | null }

export function IntegrationSettings() {
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [verifyToken, setVerifyToken] = useState("");
  const load = useCallback(async () => {
    const { data } = await sb.from("integrations").select("key, status, config, secret_refs, last_test_at, last_test_result");
    setRows(Object.fromEntries((data ?? []).map((r) => [r.key, r as Row])));
    const { data: ch } = await sb.from("channels").select("webhook_verify_token").order("created_at").limit(1).maybeSingle();
    setVerifyToken(ch?.webhook_verify_token ?? "");
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  const required = INTEGRATIONS.filter((i) => i.group !== "optional");
  const connected = required.filter((i) => rows[i.key]?.status === "connected").length;

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <p className="text-sm font-semibold">Setup progress: {connected} of {required.length} required integrations connected</p>
        <div className="mt-2 h-2 rounded-full bg-chip"><div className="h-2 rounded-full bg-brand" style={{ width: `${(connected / required.length) * 100}%` }} /></div>
        <p className="mt-2 text-xs text-muted">Each feature works in manual mode until its integration passes &ldquo;Test connection&rdquo;. Secrets are stored in the vault and never shown again (last 4 characters only). Only the owner can change them.</p>
      </Card>
      {(["phase1", "phase2", "optional"] as const).map((g) => (
        <section key={g} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{GROUP_LABEL[g]}</h2>
          {INTEGRATIONS.filter((i) => i.group === g).map((def) => (
            <IntegrationCard key={def.key} def={def} row={rows[def.key]} verifyToken={verifyToken} onChange={load} />
          ))}
        </section>
      ))}
    </div>
  );
}

function IntegrationCard({ def, row, verifyToken, onChange }: { def: IntegrationDef; row?: Row; verifyToken: string; onChange: () => void }) {
  const me = useMe();
  const owner = me.role === "owner";
  const sb = supabaseBrowser();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setValues(Object.fromEntries(def.fields.filter((f) => !f.secret).map((f) => [f.name, row?.config?.[f.name] ?? ""])));
  }, [row, def.fields]);

  const status = row?.status ?? "not_connected";
  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const config: Record<string, any> = { ...(row?.config ?? {}) };
      for (const f of def.fields.filter((x) => !x.secret)) config[f.name] = f.type === "number" && values[f.name] !== "" ? Number(values[f.name]) : values[f.name];
      const { error } = await sb.rpc("set_integration_config", { p_key: def.key, p_config: config });
      if (error) throw new Error(error.message);
      for (const f of def.fields.filter((x) => x.secret)) {
        const v = values[f.name];
        if (v) {
          const { error: e2 } = await sb.rpc("set_integration_secret", { p_key: def.key, p_field: f.name, p_value: v });
          if (e2) throw new Error(e2.message);
        }
      }
      setValues((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !def.fields.find((f) => f.name === k)?.secret)));
      setMsg({ ok: true, text: "Saved. Run Test connection to switch the feature to automatic." });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message === "only_owner_can_change_secrets" ? "Only the owner can change secrets." : (e as Error).message });
    } finally {
      setBusy("");
    }
  }
  async function test() {
    setBusy("test");
    setMsg(null);
    try {
      const r = await callFunction<{ message: string }>("integration-test", { key: def.key });
      setMsg({ ok: true, text: r.message });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy("");
    onChange();
  }
  async function generate() {
    setBusy("gen");
    try {
      await callFunction("integration-test", { action: "generate_vapid" });
      setMsg({ ok: true, text: "VAPID keys generated. Now run Test connection." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy("");
    onChange();
  }

  const generated: { label: string; value: string }[] = [];
  if (def.key === "meta_whatsapp") generated.push({ label: "Webhook URL", value: `${FUNCTIONS_URL}/wa-webhook` }, { label: "Verify token", value: verifyToken });
  if (def.key === "travelboost") generated.push({ label: "Webhook URL", value: `${FUNCTIONS_URL}/tb-webhook?company=${me.company_id}` });
  if (def.key === "web_push" && row?.config?.public_key) generated.push({ label: "VAPID public key", value: row.config.public_key });

  return (
    <Card>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left">
        <span>
          <span className="block font-semibold text-ink">{def.name}</span>
          <span className="block text-sm text-muted">{status === "connected" ? def.with : `Without it: ${def.without}`}</span>
        </span>
        <span className="flex items-center gap-2">
          {row?.last_test_at ? <span className="text-xs text-muted">tested {fmtDate(row.last_test_at)} {fmtTime(row.last_test_at)}</span> : null}
          <Badge tone={status === "connected" ? "success" : status === "error" ? "danger" : "neutral"}>{status === "connected" ? "Connected" : status === "error" ? "Error" : "Not connected"}</Badge>
        </span>
      </button>
      {open ? (
        <div className="grid gap-5 border-t border-line p-5 md:grid-cols-2">
          <div className="flex flex-col gap-3 text-sm">
            <p><span className="font-semibold">Without it:</span> {def.without}</p>
            <p><span className="font-semibold">Once connected:</span> {def.with}</p>
            {def.fields.map((f) => (
              <Field key={f.name} label={f.label} htmlFor={`${def.key}-${f.name}`}
                hint={f.secret && row?.secret_refs?.[f.name] ? <>Saved ••••{row.secret_refs[f.name].last4}. Type to replace.{f.hint ? ` ${f.hint}` : ""}</> : f.hint}>
                <Input id={`${def.key}-${f.name}`} type={f.secret ? "password" : f.type === "number" ? "number" : "text"} autoComplete="off"
                  placeholder={f.secret && row?.secret_refs?.[f.name] ? `••••${row.secret_refs[f.name].last4}` : f.placeholder}
                  value={values[f.name] ?? ""} disabled={!owner} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              </Field>
            ))}
            {def.key === "sleekflow" ? <Link href="/contacts" className="font-semibold">Go to Contacts › Import CSV</Link> : null}
            {!owner ? <p className="text-xs text-muted">Only the owner can change integration settings.</p> : null}
            <div className="flex flex-wrap gap-2">
              {owner && def.fields.length ? <Button onClick={save} disabled={busy !== ""}>{busy === "save" ? "Saving…" : "Save"}</Button> : null}
              {def.key === "web_push" && owner ? <Button variant="secondary" onClick={generate} disabled={busy !== ""}>{row?.config?.public_key ? "Regenerate keys" : "Generate keys"}</Button> : null}
              {def.testable ? <Button variant="secondary" onClick={test} disabled={busy !== ""}>{busy === "test" ? "Testing…" : "Test connection"}</Button> : null}
            </div>
            {msg ? <p role="status" className={msg.ok ? "text-success" : "text-danger"}>{msg.text}</p>
              : row?.last_test_result ? <p className={row.last_test_result.ok ? "text-success" : "text-danger"}>Last test: {row.last_test_result.message}</p> : null}
          </div>
          <div className="flex flex-col gap-3">
            {generated.map((g) => <CopyField key={g.label} label={g.label} value={g.value} />)}
            <div className="rounded-lg bg-panel p-4 text-sm">
              <p className="font-semibold">How to get the keys</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-body">{def.howTo.map((h) => <li key={h}>{h}</li>)}</ol>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
